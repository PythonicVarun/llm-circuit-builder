from __future__ import annotations

import json
import math
import os
import re
import subprocess
import tempfile
from collections import Counter
from typing import Any

from models.circuit import CheckResult, VerificationReport


def verify_spice_netlist(spice_netlist: str) -> VerificationReport:
    try:
        report = _run_pyspice_operating_point(spice_netlist)
        return _apply_static_checks(spice_netlist, report)
    except (
        Exception
    ) as exc:  # The PySpice wrapper can lag behind installed ngspice releases.
        pyspice_error = str(exc)

    try:
        report = _run_ngspice_batch_operating_point(spice_netlist)
        return _apply_static_checks(spice_netlist, report)
    except Exception as exc:
        return _simulation_failure_report(
            spice_netlist, f"PySpice failed: {pyspice_error}\nNgspice failed: {exc}"
        )


def _run_pyspice_operating_point(spice_netlist: str) -> VerificationReport:
    from PySpice.Spice.Parser import SpiceParser

    parser = SpiceParser(source=spice_netlist)
    circuit = parser.build_circuit()
    simulator = circuit.simulator(temperature=25, nominal_temperature=25)
    analysis = simulator.operating_point()

    node_voltages: dict[str, float] = {}
    for name, node in analysis.nodes.items():
        node_voltages[str(name).upper()] = _safe_float(node)

    branch_currents: dict[str, float] = {}
    for name, branch in analysis.branches.items():
        branch_currents[str(name).upper()] = _safe_float(branch)

    return VerificationReport(
        node_voltages=node_voltages, branch_currents=branch_currents
    )


def _run_ngspice_batch_operating_point(spice_netlist: str) -> VerificationReport:
    path = ""
    try:
        with tempfile.NamedTemporaryFile(
            "w", suffix=".cir", prefix="circuit-builder-", delete=False
        ) as handle:
            path = handle.name
            handle.write(spice_netlist)
            if not spice_netlist.endswith("\n"):
                handle.write("\n")

        completed = subprocess.run(
            ["ngspice", "-b", path],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        output = "\n".join(
            part for part in (completed.stdout, completed.stderr) if part
        )
        if completed.returncode != 0:
            raise RuntimeError(output.strip() or f"ngspice exited {completed.returncode}")
        return _parse_ngspice_batch_output(output)
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


def _parse_ngspice_batch_output(output: str) -> VerificationReport:
    node_voltages: dict[str, float] = {}
    branch_currents: dict[str, float] = {}
    table: str | None = None
    devices: list[str] = []

    for raw_line in output.splitlines():
        line = raw_line.strip()
        lower = line.lower()
        if not line:
            continue
        if lower.startswith("node") and "voltage" in lower:
            table = "nodes"
            devices = []
            continue
        if lower.startswith("source") and "current" in lower:
            table = "sources"
            devices = []
            continue
        if set(line) <= {"-", "\t", " "}:
            continue
        if lower.startswith("device"):
            parts = line.split()
            devices = [part.upper() for part in parts[1:]]
            table = None
            continue

        if table == "nodes":
            match = _numbered_row(line)
            if match:
                node_voltages[match[0].upper()] = _safe_float(match[1])
                continue
            table = None
        if table == "sources":
            match = _numbered_row(line)
            if match:
                branch = match[0].split("#", 1)[0].upper()
                branch_currents[branch] = _safe_float(match[1])
                continue
            table = None
        if devices:
            parts = line.split()
            key = parts[0].lower()
            if key in {"i", "id"} and len(parts) >= len(devices) + 1:
                for device, value in zip(devices, parts[1:]):
                    branch_currents[device] = _safe_float(value)

    if node_voltages:
        node_voltages.setdefault("0", 0.0)
    if not node_voltages:
        raise RuntimeError("ngspice completed but no operating-point nodes were found")

    return VerificationReport(
        node_voltages=node_voltages, branch_currents=branch_currents
    )


def _numbered_row(line: str) -> tuple[str, str] | None:
    match = re.match(
        r"^([A-Za-z_][\w#$.()-]*)\s+([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)$",
        line,
    )
    if not match:
        return None
    name = match.group(1)
    # Strip V(...) wrapper so node "1" stores as "1", not "V(1)".
    inner = re.match(r"^[Vv]\((.+)\)$", name)
    if inner:
        name = inner.group(1)
    return name, match.group(2)


def _simulation_failure_report(
    spice_netlist: str, pyspice_error: str
) -> VerificationReport:
    report = VerificationReport(raw_output=pyspice_error)
    report = _apply_static_checks(spice_netlist, report)
    report.status = "error"
    report.errors.insert(
        0,
        "Ngspice simulation failed; no operating-point voltages or currents were produced.",
    )
    report.checks["simulation"] = _check(
        False,
        "Ngspice could not solve this netlist. Check SPICE syntax, component models, and unsupported element formats.",
        severity="error",
    )
    report.checks["voltage_levels"] = _check(
        False,
        "Node voltages are unavailable because simulation failed.",
        value="0 nodes",
        severity="error",
    )
    return report


def _apply_static_checks(
    spice_netlist: str, report: VerificationReport
) -> VerificationReport:
    metadata = _extract_metadata(spice_netlist)
    warnings: list[str] = []
    errors: list[str] = []
    checks: dict[str, CheckResult] = {}

    branches = metadata.get("branches") or []
    source_voltage = _source_voltage(spice_netlist) or float(
        metadata.get("source_voltage", 0) or 0
    )
    direct_leds = _detect_direct_leds(spice_netlist)
    zero_ohm = _detect_zero_ohm_paths(spice_netlist)
    floating_nodes = _detect_open_nodes(spice_netlist)

    checks["voltage_levels"] = _check(
        all(
            abs(v) <= max(source_voltage, 1) * 1.1 + 0.25
            for v in report.node_voltages.values()
        ),
        "All solved node voltages are within the source envelope.",
        value=f"{len(report.node_voltages)} nodes",
    )

    led_currents = _led_currents(report.branch_currents, branches)
    if direct_leds:
        errors.append("LED branch is connected without a current-limiting resistor.")
        checks["led_current"] = _check(
            False,
            "LED is connected directly to the source without current limiting.",
            severity="error",
        )
    elif led_currents:
        highest_ma = max(abs(current) * 1000 for current in led_currents)
        in_range = all(10 <= abs(current) * 1000 <= 30 for current in led_currents)
        message = (
            "Within safe range (10-30 mA)"
            if in_range
            else "Outside safe LED current range (10-30 mA)"
        )
        checks["led_current"] = _check(
            in_range, message, value=round(highest_ma, 2), unit="mA", severity="warning"
        )
        if not in_range:
            warnings.append(message)
    elif _has_diode_element(spice_netlist):
        checks["led_current"] = _check(
            False,
            "LED current could not be solved from this netlist.",
            severity="warning",
        )
        warnings.append("LED current could not be solved from this netlist.")
    else:
        checks["led_current"] = _check(
            True, "No LED current check required for this circuit."
        )

    power_results = _resistor_power_results(branches, report.branch_currents)
    if power_results:
        worst = max(power_results, key=lambda item: item["power_w"])
        ok = all(item["power_w"] <= item["limit_w"] for item in power_results)
        checks["power_dissipation"] = _check(
            ok,
            (
                "Resistor dissipation is below rated wattage."
                if ok
                else "At least one resistor exceeds its wattage rating."
            ),
            value=round(worst["power_w"] * 1000, 2),
            unit="mW",
            limit=f"{worst['limit_w'] * 1000:.0f} mW",
            severity="warning",
        )
        if not ok:
            warnings.append("At least one resistor exceeds its wattage rating.")
    else:
        checks["power_dissipation"] = _check(
            True, "No resistor dissipation issue detected."
        )

    checks["short_circuit"] = _check(
        not zero_ohm and not direct_leds,
        (
            "None detected."
            if not zero_ohm and not direct_leds
            else "Possible short or unprotected low-resistance path detected."
        ),
        severity="error",
    )
    if zero_ohm:
        errors.append("A zero-ohm or near-zero resistor path was detected.")

    checks["open_circuit"] = _check(
        not floating_nodes,
        (
            "None detected."
            if not floating_nodes
            else f"Possibly floating nodes: {', '.join(floating_nodes[:4])}"
        ),
        severity="warning",
    )
    if floating_nodes:
        warnings.append(f"Possibly floating nodes: {', '.join(floating_nodes[:4])}")

    checks["component_ratings"] = _check(
        not errors,
        (
            "All known component ratings are respected."
            if not errors
            else "One or more component ratings are violated."
        ),
        severity="error",
    )

    status = "valid"
    if errors or any(
        not check.pass_ and check.severity == "error" for check in checks.values()
    ):
        status = "error"
    elif warnings or any(not check.pass_ for check in checks.values()):
        status = "warning"

    report.status = status
    report.checks = checks
    report.warnings = warnings
    report.errors = errors
    return report


def _extract_metadata(spice_netlist: str) -> dict[str, Any]:
    for line in spice_netlist.splitlines():
        if line.startswith("* @circuit_meta "):
            try:
                return json.loads(line.removeprefix("* @circuit_meta ").strip())
            except json.JSONDecodeError:
                return {}
    return {}


def _source_voltage(spice_netlist: str) -> float | None:
    match = re.search(
        r"(?im)^\s*V\w*\s+\S+\s+\S+\s+DC\s+([-+]?\d+(?:\.\d+)?)", spice_netlist
    )
    return float(match.group(1)) if match else None


def _led_currents(
    branch_currents: dict[str, float], branches: list[dict]
) -> list[float]:
    currents: list[float] = []
    if branches:
        for branch in branches:
            if branch.get("kind") in {"led", "series_leds"}:
                current = float(branch.get("current_a") or 0)
                if current:
                    currents.append(current)
        return currents
    for key, value in branch_currents.items():
        if key.upper().startswith("D"):
            currents.append(value)
    return currents


def _resistor_power_results(
    branches: list[dict], branch_currents: dict[str, float]
) -> list[dict[str, float]]:
    results: list[dict[str, float]] = []
    if branches:
        for branch in branches:
            resistor = str(branch.get("resistor", "")).upper()
            resistance = float(branch.get("resistor_ohm") or 0)
            current = abs(
                float(branch.get("current_a") or branch_currents.get(resistor, 0))
            )
            if resistance > 0 and current > 0:
                results.append(
                    {"power_w": current * current * resistance, "limit_w": 0.25}
                )
    return results


def _detect_direct_leds(spice_netlist: str) -> list[str]:
    direct = []
    for line in spice_netlist.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("*", ".")):
            continue
        parts = stripped.split()
        if parts[0].upper().startswith("D") and len(parts) >= 3:
            anode, cathode = parts[1].upper(), parts[2].upper()
            if {anode, cathode} in [{"VCC", "0"}, {"VDD", "0"}]:
                direct.append(parts[0])
    return direct


def _has_diode_element(spice_netlist: str) -> bool:
    return bool(re.search(r"(?im)^\s*D\w*\s+\S+\s+\S+\s+\S+", spice_netlist))


def _detect_zero_ohm_paths(spice_netlist: str) -> list[str]:
    paths = []
    for match in re.finditer(
        r"(?im)^\s*(R\w*)\s+\S+\s+\S+\s+([-+]?\d+(?:\.\d+)?)", spice_netlist
    ):
        if float(match.group(2)) <= 0.1:
            paths.append(match.group(1).upper())
    return paths


def _detect_open_nodes(spice_netlist: str) -> list[str]:
    counts: Counter[str] = Counter()
    for line in spice_netlist.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("*", ".")):
            continue
        parts = stripped.split()
        if len(parts) < 4:
            continue
        if parts[0][0].upper() in {"R", "C", "L", "D", "V", "I", "Q", "S"}:
            for node in parts[1:3]:
                normalized = node.upper()
                if normalized not in {"0", "GND"}:
                    counts[normalized] += 1
    floating = [
        node
        for node, count in counts.items()
        if count == 1 and node not in {"VCC", "VDD"}
    ]
    return floating


def _check(
    passed: bool,
    message: str,
    value: float | str | None = None,
    unit: str | None = None,
    limit: float | str | None = None,
    severity: str = "info",
) -> CheckResult:
    return CheckResult(pass_=passed, message=message, value=value, unit=unit, limit=limit, severity=severity)  # type: ignore[arg-type]


def _safe_float(value: Any) -> float:
    try:
        numeric = float(value)
        return 0.0 if math.isnan(numeric) else round(numeric, 6)
    except Exception:
        return 0.0
