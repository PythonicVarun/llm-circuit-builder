from __future__ import annotations

import asyncio
import json
import os
import re
from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import Any, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from pydantic import ValidationError

from models.circuit import (
    AgentStep,
    CircuitIntent,
    CircuitResult,
    NetlistBundle,
    VerificationReport,
    VisualizationConfig,
)

from .netlist_generator import (
    CircuitGenerationError,
    led_color_hex,
    render_netlist_bundle,
    validate_breadboard,
)
from .prompts import GENERATE_CIRCUIT_PROMPT, PARSE_INTENT_PROMPT
from .verifier import verify_spice_netlist

EXAMPLE_PROMPTS = [
    {
        "title": "Christmas tree lighting",
        "prompt": "Christmas tree lighting with 5 red LEDs in parallel, a 9V battery, and current-limiting resistors",
    },
    {
        "title": "Traffic light system",
        "prompt": "Traffic light system using red, yellow, and green LEDs with a 555 timer",
    },
    {
        "title": "Flasher circuit",
        "prompt": "Two LEDs alternating using an astable multivibrator with 2 NPN transistors",
    },
    {
        "title": "Simple torch",
        "prompt": "Simple torch with 3 white LEDs in series from a 12V battery and one resistor",
    },
    {
        "title": "Doorbell buzzer",
        "prompt": "Doorbell buzzer with a piezo buzzer and an NPN transistor switch",
    },
]


ProgressCallback = Callable[[AgentStep], Awaitable[None]]


class AgentGraphState(TypedDict, total=False):
    prompt: str
    progress: ProgressCallback | None
    intent: CircuitIntent
    circuit_payload: dict[str, Any]
    netlists: NetlistBundle
    verification: VerificationReport
    visualization: VisualizationConfig


class CircuitAgent:
    def __init__(self) -> None:
        self._anthropic_model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
        self.graph = self._build_graph()

    async def generate(
        self, prompt: str, progress: ProgressCallback | None = None
    ) -> CircuitResult:
        steps: list[AgentStep] = []

        async def emit_step(agent_step: AgentStep) -> None:
            steps.append(agent_step)
            if progress:
                await progress(agent_step)

        final_state = await self.graph.ainvoke(
            {"prompt": prompt, "progress": emit_step}
        )
        return CircuitResult(
            prompt=prompt,
            intent=final_state["intent"],
            spice_netlist=final_state["netlists"].spice_netlist,
            circuitjs_text=final_state["netlists"].circuitjs_text,
            schemdraw_code=final_state["netlists"].schemdraw_code,
            schematic_svg=final_state["netlists"].schematic_svg,
            verification=final_state["verification"],
            visualization_config=final_state["visualization"],
            agent_steps=steps,
        )

    def _build_graph(self):
        graph = StateGraph(AgentGraphState)
        graph.add_node("parse_intent", self._parse_intent_node)
        graph.add_node("generate_circuit", self._generate_circuit_node)
        graph.add_node("verify_circuit", self._verify_circuit_node)
        graph.add_node("build_visualization", self._visualization_node)
        graph.set_entry_point("parse_intent")
        graph.add_edge("parse_intent", "generate_circuit")
        graph.add_edge("generate_circuit", "verify_circuit")
        graph.add_edge("verify_circuit", "build_visualization")
        graph.add_edge("build_visualization", END)
        return graph.compile()

    async def _emit_state(
        self, state: AgentGraphState, step: str, status: str, message: str
    ) -> None:
        callback = state.get("progress")
        if callback:
            await callback(AgentStep(step=step, status=status, message=message))  # type: ignore[arg-type]

    async def _parse_intent_node(
        self, state: AgentGraphState
    ) -> dict[str, CircuitIntent]:
        await self._emit_state(
            state, "Parsing", "active", "Extracting components and topology"
        )
        intent = await self.parse_intent(state["prompt"])
        await self._emit_state(
            state, "Parsing", "complete", f"Detected {intent.circuit_name}"
        )
        return {"intent": intent}

    async def _generate_circuit_node(
        self, state: AgentGraphState
    ) -> dict[str, Any]:
        await self._emit_state(
            state,
            "Generating Netlist",
            "active",
            "Asking Claude for SPICE, CircuitJS, schematic, and breadboard",
        )
        try:
            payload = await self._generate_circuit_payload(
                state["prompt"], state["intent"]
            )
            netlists = render_netlist_bundle(payload)
        except CircuitGenerationError as exc:
            await self._emit_state(state, "Generating Netlist", "error", str(exc))
            raise
        except ValueError as exc:
            await self._emit_state(state, "Generating Netlist", "error", str(exc))
            raise CircuitGenerationError(str(exc)) from exc
        await self._emit_state(
            state,
            "Generating Netlist",
            "complete",
            "Received valid netlists from Claude",
        )
        return {"netlists": netlists, "circuit_payload": payload}

    async def _verify_circuit_node(
        self, state: AgentGraphState
    ) -> dict[str, VerificationReport]:
        await self._emit_state(
            state, "Simulating", "active", "Running operating-point verification"
        )
        verification = verify_spice_netlist(state["netlists"].spice_netlist)
        status = "complete" if verification.status != "error" else "error"
        await self._emit_state(
            state, "Simulating", status, f"Verification status: {verification.status}"
        )
        return {"verification": verification}

    async def _visualization_node(
        self, state: AgentGraphState
    ) -> dict[str, VisualizationConfig]:
        await self._emit_state(
            state, "Rendering", "active", "Preparing interactive component states"
        )
        visualization = self._build_visualization(
            state["circuit_payload"], state["verification"]
        )
        await self._emit_state(state, "Rendering", "complete", "Visualization ready")
        return {"visualization": visualization}

    async def parse_intent(self, prompt: str) -> CircuitIntent:
        payload = await self._call_claude_json(
            PARSE_INTENT_PROMPT, prompt, step_name="intent"
        )
        return _normalize_intent(prompt, payload)

    async def _generate_circuit_payload(
        self, prompt: str, intent: CircuitIntent
    ) -> dict[str, Any]:
        user_message = json.dumps(
            {
                "prompt": prompt,
                "intent": intent.model_dump(),
            },
            ensure_ascii=False,
        )
        payload = await self._call_claude_json(
            GENERATE_CIRCUIT_PROMPT, user_message, step_name="circuit"
        )
        if not isinstance(payload, dict):
            raise CircuitGenerationError(
                "Claude returned a non-object response for the circuit payload."
            )
        payload = _unwrap_circuit_payload(payload)
        payload["circuit_name"] = intent.circuit_name
        return payload

    async def _call_claude_json(
        self, system_prompt: str, user_message: str, *, step_name: str
    ) -> Any:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise CircuitGenerationError(
                "ANTHROPIC_API_KEY is not set; this build requires an Anthropic API "
                "key to generate circuits."
            )

        model = ChatAnthropic(
            model=self._anthropic_model,
            temperature=0,
            base_url=os.getenv("ANTHROPIC_BASE_URL"),
            api_key=api_key
        )
        # Prefill the assistant turn with "{" so Claude continues an open JSON
        # object instead of optionally emitting a markdown fence or preamble.
        prefill = "{"
        try:
            response = await model.ainvoke(
                [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=user_message),
                    AIMessage(content=prefill),
                ]
            )
        except Exception as exc:  # network / API failure surfaces to UI
            raise CircuitGenerationError(
                f"Anthropic API call for {step_name} failed: {exc}"
            ) from exc

        raw = _message_content_to_text(response.content)
        # The API does not echo the prefill back, so re-attach it before parsing.
        content = prefill + raw if not raw.lstrip().startswith("{") else raw
        finish_reason = _detect_truncation(response)

        json_text = _extract_json_from_text(content)
        if not json_text:
            suffix = (
                " The response appears to have been truncated by the model's "
                "max_tokens budget; try a simpler prompt or increase max_tokens."
                if finish_reason
                else ""
            )
            raise CircuitGenerationError(
                f"Claude {step_name} response did not contain JSON.{suffix} "
                f"First 600 chars: {content[:600]}"
            )
        try:
            return json.loads(json_text)
        except json.JSONDecodeError as exc:
            try:
                return json.loads(content)
            except json.JSONDecodeError as exc2:
                suffix = (
                    " The response was truncated mid-stream by max_tokens."
                    if finish_reason
                    else ""
                )
                raise CircuitGenerationError(
                    f"Claude {step_name} response was not valid JSON: {exc2}.{suffix} "
                    f"First 600 chars: {content[:600]}"
                ) from exc

    def _build_visualization(
        self, payload: dict[str, Any], verification: VerificationReport
    ) -> VisualizationConfig:
        diagram = validate_breadboard(payload.get("breadboard"))
        states = _hydrate_part_states(diagram, verification)
        return VisualizationConfig(wokwi_diagram=diagram, component_states=states)


def _hydrate_part_states(
    diagram: dict[str, Any], verification: VerificationReport
) -> dict[str, dict[str, Any]]:
    """Attach live current/brightness state to each LED/buzzer/switch using the
    SPICE branch currents. This does not invent components — it only annotates
    those the LLM already placed."""
    states: dict[str, dict[str, Any]] = {}
    branch_currents = verification.branch_currents

    led_index = 0
    for part in diagram.get("parts", []):
        part_type = str(part.get("type", "")).lower()
        part_id = str(part.get("id"))
        attrs = part.get("attrs") or {}
        if part_type == "wokwi-led":
            led_index += 1
            color = attrs.get("color") or "red"
            current_a = abs(
                branch_currents.get(
                    f"D{led_index}",
                    branch_currents.get(f"R{led_index}", 0.0),
                )
            )
            current_ma = current_a * 1000
            brightness = max(0.0, min(current_ma / 22, 1.0))
            states[part_id] = {
                "on": current_ma >= 0.5,
                "brightness": round(brightness, 2),
                "current_ma": round(current_ma, 2),
                "color": led_color_hex(color),
            }
        elif part_type == "wokwi-buzzer":
            current_a = abs(
                branch_currents.get("BUZZER1", branch_currents.get("RBUZ", 0.0))
            )
            current_ma = current_a * 1000
            states[part_id] = {
                "on": current_ma > 5,
                "current_ma": round(current_ma, 2),
                "sound": current_ma > 5,
            }
        elif part_type == "wokwi-slide-switch":
            states[part_id] = {"closed": True}
    return states


def _unwrap_circuit_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Unwrap common nesting keys the model might use, but never invent fields."""
    for key in ("circuit", "result", "data", "output"):
        nested = payload.get(key)
        if isinstance(nested, dict) and "spice_netlist" in nested:
            return deepcopy(nested)
    return deepcopy(payload)


def _normalize_intent(prompt: str, payload: dict[str, Any] | None) -> CircuitIntent:
    if not isinstance(payload, dict):
        raise CircuitGenerationError(
            "Claude did not return a JSON object for circuit intent."
        )

    candidate = _unwrap_intent_payload(payload)
    candidate = _canonicalize_intent_payload(prompt, candidate)
    try:
        return CircuitIntent.model_validate(candidate)
    except ValidationError as exc:
        raise CircuitGenerationError(
            "Claude returned JSON, but it could not be converted to CircuitIntent: "
            f"{exc}. Payload: {json.dumps(payload, ensure_ascii=False)[:1500]}"
        ) from exc


def _unwrap_intent_payload(payload: dict[str, Any]) -> dict[str, Any]:
    candidate = payload
    for key in ("circuit", "intent", "result", "data", "output"):
        nested = candidate.get(key)
        if isinstance(nested, dict):
            candidate = nested
            break
    return deepcopy(candidate)


def _canonicalize_intent_payload(prompt: str, payload: dict[str, Any]) -> dict[str, Any]:
    components = payload.get("components") or payload.get("parts") or []
    if isinstance(components, dict):
        components = list(components.values())
    if not isinstance(components, list):
        components = []

    canonical_components = _aggregate_components(
        [
            _canonicalize_component(component)
            for component in components
            if isinstance(component, dict)
        ]
    )

    topology = payload.get("topology", "mixed")
    if isinstance(topology, dict):
        topology = (
            topology.get("type")
            or topology.get("name")
            or topology.get("description")
            or "mixed"
        )
    elif isinstance(topology, list):
        topology = ", ".join(str(item) for item in topology)

    source_voltage = _coerce_float(
        payload.get("source_voltage")
        or payload.get("supply_voltage")
        or payload.get("voltage")
    )
    if source_voltage is None:
        source_voltage = _source_voltage_from_components(canonical_components) or 9.0

    circuit_name = (
        payload.get("circuit_name")
        or payload.get("name")
        or payload.get("title")
        or _title_from_prompt(prompt)
    )
    purpose = payload.get("purpose") or payload.get("description") or prompt
    notes = payload.get("notes") if isinstance(payload.get("notes"), list) else []

    return {
        "circuit_name": str(circuit_name),
        "components": canonical_components,
        "topology": str(topology),
        "purpose": str(purpose),
        "source_voltage": float(source_voltage),
        "notes": [str(note) for note in notes],
    }


def _canonicalize_component(component: dict[str, Any]) -> dict[str, Any]:
    raw_type = str(
        component.get("type") or component.get("kind") or component.get("name") or "component"
    )
    component_type = _canonical_component_type(raw_type)

    value_ohm = _coerce_float(
        component.get("value_ohm")
        or component.get("resistance_ohm")
        or component.get("resistance")
        or (component.get("value") if "resistor" in component_type.lower() else None)
    )
    voltage = _coerce_float(
        component.get("voltage")
        or component.get("forward_voltage")
        or component.get("vf")
        or (
            component.get("value")
            if component_type.lower() in {"battery", "power supply", "supply"}
            else None
        )
    )
    current_ma = _coerce_current_ma(
        component.get("current_ma")
        or component.get("forward_current")
        or component.get("current")
        or component.get("if")
    )
    wattage_w = _coerce_float(
        component.get("wattage_w")
        or component.get("power_rating_w")
        or component.get("power_rating")
        or component.get("wattage")
    )

    attrs = component.get("attrs") if isinstance(component.get("attrs"), dict) else {}
    for key in ("id", "purpose", "model", "value", "description"):
        if key in component and key not in attrs:
            attrs[key] = component[key]

    count = int(_coerce_float(component.get("count") or component.get("quantity")) or 1)
    return {
        "type": component_type,
        "count": max(count, 1),
        "color": component.get("color"),
        "voltage": voltage,
        "current_ma": current_ma,
        "value_ohm": value_ohm,
        "wattage_w": wattage_w,
        "attrs": attrs,
    }


def _aggregate_components(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for component in components:
        key = (
            component.get("type"),
            component.get("color"),
            component.get("voltage"),
            component.get("current_ma"),
            component.get("value_ohm"),
            component.get("wattage_w"),
        )
        if key in grouped:
            grouped[key]["count"] += component.get("count", 1)
            continue
        grouped[key] = {
            "type": component.get("type"),
            "count": component.get("count", 1),
            "color": component.get("color"),
            "voltage": component.get("voltage"),
            "current_ma": component.get("current_ma"),
            "value_ohm": component.get("value_ohm"),
            "wattage_w": component.get("wattage_w"),
            "attrs": component.get("attrs") or {},
        }
    return list(grouped.values())


def _canonical_component_type(component_type: str) -> str:
    normalized = component_type.strip().lower().replace("_", " ")
    if normalized in {"led", "light emitting diode", "light-emitting diode"}:
        return "LED"
    if "resistor" in normalized:
        return "resistor"
    if normalized in {"battery", "cell"} or "battery" in normalized:
        return "battery"
    if "buzzer" in normalized or "piezo" in normalized:
        return "buzzer"
    if "555" in normalized:
        return "555 timer"
    if "transistor" in normalized and ("npn" in normalized or "bjt" in normalized):
        return "NPN transistor"
    if "capacitor" in normalized:
        return "capacitor"
    if "switch" in normalized:
        return "switch"
    return component_type.strip()


def _source_voltage_from_components(components: list[dict[str, Any]]) -> float | None:
    for component in components:
        if str(component.get("type", "")).lower() in {
            "battery",
            "power supply",
            "supply",
        }:
            voltage = _coerce_float(component.get("voltage"))
            if voltage is not None:
                return voltage
    return None


def _coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().lower().replace(",", "")
    multiplier = 1.0
    if "k" in text and "w" not in text:
        multiplier = 1000.0
    elif "m" in text and "ma" not in text and "mv" not in text:
        multiplier = 1_000_000.0
    match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
    if not match:
        return None
    return float(match.group(0)) * multiplier


def _coerce_current_ma(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().lower()
    numeric = _coerce_float(text)
    if numeric is None:
        return None
    if "ma" in text:
        return numeric
    if re.search(r"(^|[^m])a\b", text):
        return numeric * 1000
    return numeric


def _title_from_prompt(prompt: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", prompt)[:6]
    return " ".join(word.capitalize() for word in words) or "Generated Circuit"


def _extract_json_from_text(text: str) -> str | None:
    """Extract a JSON object/array from a model response.

    Models sometimes wrap output in ```json ... ``` fences or add a chatty
    preamble like "Here is the JSON:" before/after the object — be forgiving:
    1. Try a brace-balanced scan first (string-aware) so JSON containing literal
       backticks (e.g. an SVG with ``` inside) is not truncated.
    2. Fall back to a fenced-block extraction.
    3. Last resort: strip any markdown fence wrapper and return the remainder.
    """
    cleaned = _strip_fences(text)

    extracted = _scan_balanced_json(cleaned)
    if extracted:
        return extracted

    extracted = _scan_balanced_json(text)
    if extracted:
        return extracted

    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if m:
        candidate = m.group(1).strip()
        if candidate:
            return candidate

    return None


def _strip_fences(text: str) -> str:
    """Remove leading/trailing markdown code fences without touching inner content."""
    stripped = text.strip()
    if stripped.startswith("```"):
        # drop opening fence (with optional language tag)
        stripped = re.sub(r"^```[A-Za-z0-9_-]*\s*\n?", "", stripped)
        if stripped.endswith("```"):
            stripped = stripped[: -3].rstrip()
    return stripped


def _scan_balanced_json(text: str) -> str | None:
    start = None
    for i, ch in enumerate(text):
        if ch == "{" or ch == "[":
            start = i
            break
    if start is None:
        return None

    stack: list[str] = []
    in_string = False
    escape = False
    for j in range(start, len(text)):
        ch = text[j]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if not stack:
                return None
            stack.pop()
            if not stack:
                return text[start : j + 1]
    return None


def _detect_truncation(response: Any) -> bool:
    """Return True when the API marked the response as cut off by max_tokens."""
    metadata = getattr(response, "response_metadata", None) or {}
    stop_reason = (
        metadata.get("stop_reason")
        or metadata.get("finish_reason")
        or ""
    )
    return str(stop_reason).lower() in {"max_tokens", "length"}


def _message_content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
                elif item.get("type") == "tool_use":
                    parts.append(json.dumps(item, ensure_ascii=False))
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return str(content)


async def maybe_await(value: Any) -> Any:
    if asyncio.iscoroutine(value):
        return await value
    return value
