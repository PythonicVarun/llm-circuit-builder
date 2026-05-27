"""Helpers for converting an LLM-generated circuit payload into the formats
the rest of the app expects (SPICE text, CircuitJS line-oriented text, schematic SVG,
schemdraw code, and a breadboard diagram). No per-circuit templates live here —
every artifact comes from the LLM and we only normalize / render it."""
from __future__ import annotations

import html
import json
from typing import Any

from models.circuit import NetlistBundle

LED_FORWARD_VOLTAGE = {
    "red": 2.0,
    "yellow": 2.1,
    "green": 2.2,
    "blue": 3.1,
    "white": 3.2,
}

LED_HEX = {
    "red": "#ff2200",
    "yellow": "#ffd84a",
    "green": "#26e36a",
    "blue": "#49a7ff",
    "white": "#f7fbff",
}


class CircuitGenerationError(ValueError):
    """Raised when the LLM payload cannot be turned into a usable circuit."""


def led_forward_voltage(color: str | None) -> float:
    return LED_FORWARD_VOLTAGE.get((color or "red").lower(), 2.0)


def led_color_hex(color: str | None) -> str:
    return LED_HEX.get((color or "red").lower(), "#ff2200")


def render_netlist_bundle(payload: dict[str, Any]) -> NetlistBundle:
    """Validate the LLM circuit payload and produce a NetlistBundle.

    Raises CircuitGenerationError with a precise message when a required field
    is missing or wrongly shaped, so the UI can show the real error instead of
    falling back to a stock circuit.
    """
    if not isinstance(payload, dict):
        raise CircuitGenerationError(
            "Circuit generator returned a non-object payload."
        )

    spice = payload.get("spice_netlist")
    if not isinstance(spice, str) or not spice.strip():
        raise CircuitGenerationError(
            "Circuit generator did not return a SPICE netlist (spice_netlist missing or empty)."
        )

    circuitjs_elements = payload.get("circuitjs")
    if not isinstance(circuitjs_elements, list) or not circuitjs_elements:
        raise CircuitGenerationError(
            "Circuit generator did not return any CircuitJS elements."
        )
    circuitjs_text = _render_circuitjs_text(circuitjs_elements)

    schematic_svg = payload.get("schematic_svg")
    if not isinstance(schematic_svg, str) or "<svg" not in schematic_svg:
        raise CircuitGenerationError(
            "Circuit generator did not return a usable schematic SVG."
        )

    return NetlistBundle(
        spice_netlist=spice.strip(),
        circuitjs_text=circuitjs_text,
        schemdraw_code=_schemdraw_summary(payload),
        schematic_svg=schematic_svg,
    )


def _render_circuitjs_text(elements: list[Any]) -> str:
    """Convert structured CircuitJS elements into the legacy line-based format
    consumed by the self-hosted viewer."""
    lines: list[str] = ["$ 1 0.000005 10.20027730826997 50 5 43 5e-11"]
    for element in elements:
        if not isinstance(element, dict):
            continue
        etype = str(element.get("type", "")).lower()
        try:
            x1 = int(round(float(element["x1"])))
            y1 = int(round(float(element["y1"])))
            x2 = int(round(float(element["x2"])))
            y2 = int(round(float(element["y2"])))
        except (KeyError, TypeError, ValueError) as exc:
            raise CircuitGenerationError(
                f"CircuitJS element missing coordinates: {element!r} ({exc})"
            ) from exc

        if etype == "v":
            voltage = element.get("voltage", 9)
            lines.append(f"v {x1} {y1} {x2} {y2} 0 0 40 {voltage} 0 0 0.5")
        elif etype == "w":
            lines.append(f"w {x1} {y1} {x2} {y2} 0")
        elif etype == "r":
            value = element.get("value", 330)
            lines.append(f"r {x1} {y1} {x2} {y2} 0 {value}")
        elif etype == "d":
            color = str(element.get("color", "red")).lower()
            lines.append(f"d {x1} {y1} {x2} {y2} 1 0.805904783 {color}")
        elif etype == "c":
            value = element.get("value", "10u")
            lines.append(f"c {x1} {y1} {x2} {y2} 0 0.00001 0 {value}")
        elif etype == "t":
            lines.append(f"t {x1} {y1} {x2} {y2} 0 1")
        elif etype == "ic":
            label = str(element.get("label", "IC")).replace(" ", "_")
            lines.append(f"ic {x1} {y1} {x2} {y2} {label}")
        elif etype == "s":
            closed = element.get("closed", True)
            lines.append(f"s {x1} {y1} {x2} {y2} 0 {'1' if closed else '0'} false")
        else:
            # Unknown element kind — pass through as a wire so something still draws.
            lines.append(f"w {x1} {y1} {x2} {y2} 0")
    return "\n".join(lines)


def _schemdraw_summary(payload: dict[str, Any]) -> str:
    """Produce a tiny schemdraw stub from the LLM payload. We keep this in the
    bundle for completeness even though the UI currently uses the SVG."""
    name = payload.get("circuit_name") or "Generated Circuit"
    summary = json.dumps(
        {
            "name": name,
            "spice_lines": payload.get("spice_netlist", "").count("\n") + 1,
            "elements": len(payload.get("circuitjs") or []),
        },
        indent=2,
    )
    return (
        "import schemdraw\nimport schemdraw.elements as elm\n"
        f"# LLM-generated circuit summary\nsummary = {summary}\n"
    )


def validate_breadboard(breadboard: Any) -> dict[str, Any]:
    """Validate the breadboard payload from the LLM and normalize it."""
    if not isinstance(breadboard, dict):
        raise CircuitGenerationError(
            "Circuit generator did not return a breadboard object."
        )
    parts = breadboard.get("parts")
    connections = breadboard.get("connections")
    if not isinstance(parts, list) or not parts:
        raise CircuitGenerationError(
            "Circuit generator returned an empty breadboard parts list."
        )
    if not isinstance(connections, list):
        raise CircuitGenerationError(
            "Circuit generator did not return a breadboard connections list."
        )

    normalized_parts: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for raw in parts:
        if not isinstance(raw, dict):
            continue
        part_id = str(raw.get("id") or "").strip()
        part_type = str(raw.get("type") or "").strip()
        if not part_id or not part_type:
            continue
        if part_id in seen_ids:
            continue
        seen_ids.add(part_id)
        attrs = raw.get("attrs") if isinstance(raw.get("attrs"), dict) else {}
        normalized_parts.append(
            {
                "type": part_type,
                "id": part_id,
                "top": int(float(raw.get("top", 80))),
                "left": int(float(raw.get("left", 80))),
                "attrs": attrs,
            }
        )
    if not normalized_parts:
        raise CircuitGenerationError(
            "Breadboard parts payload contained no valid parts."
        )

    normalized_connections: list[list[Any]] = []
    for raw in connections:
        if not isinstance(raw, (list, tuple)) or len(raw) < 2:
            continue
        src = str(raw[0])
        dst = str(raw[1])
        color = str(raw[2]) if len(raw) >= 3 else "red"
        normalized_connections.append([src, dst, color, []])

    return {
        "version": 1,
        "author": "circuit-agent",
        "editor": {"zoom": 1.15},
        "parts": normalized_parts,
        "connections": normalized_connections,
    }


def fallback_svg_title(name: str) -> str:
    return html.escape(name)
