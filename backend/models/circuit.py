from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

CircuitStatus = Literal["valid", "warning", "error"]
AgentStepName = Literal["Parsing", "Generating Netlist", "Simulating", "Rendering"]
AgentStepStatus = Literal["pending", "active", "complete", "error"]


class CircuitRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=2000)


class VerifyRequest(BaseModel):
    spice_netlist: str = Field(..., min_length=3)


class ComponentSpec(BaseModel):
    type: str
    count: int = Field(default=1, ge=1)
    color: str | None = None
    voltage: float | None = None
    current_ma: float | None = None
    value_ohm: float | None = None
    wattage_w: float | None = None
    attrs: dict[str, Any] = Field(default_factory=dict)


class CircuitIntent(BaseModel):
    circuit_name: str
    components: list[ComponentSpec]
    topology: str = "mixed"
    purpose: str = "general electronics"
    source_voltage: float = 9.0
    notes: list[str] = Field(default_factory=list)


class NetlistBundle(BaseModel):
    spice_netlist: str
    circuitjs_text: str
    schemdraw_code: str
    schematic_svg: str


class CheckResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    pass_: bool = Field(alias="pass")
    message: str = ""
    value: float | str | None = None
    unit: str | None = None
    limit: float | str | None = None
    severity: Literal["info", "warning", "error"] = "info"


class VerificationReport(BaseModel):
    status: CircuitStatus = "valid"
    node_voltages: dict[str, float] = Field(default_factory=dict)
    branch_currents: dict[str, float] = Field(default_factory=dict)
    checks: dict[str, CheckResult] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    raw_output: str | None = None


class VisualizationConfig(BaseModel):
    wokwi_diagram: dict[str, Any]
    component_states: dict[str, dict[str, Any]]


class AgentStep(BaseModel):
    step: AgentStepName
    status: AgentStepStatus
    message: str = ""


class CircuitResult(BaseModel):
    prompt: str
    intent: CircuitIntent
    spice_netlist: str
    circuitjs_text: str
    schemdraw_code: str
    schematic_svg: str
    verification: VerificationReport
    visualization_config: VisualizationConfig
    agent_steps: list[AgentStep] = Field(default_factory=list)
