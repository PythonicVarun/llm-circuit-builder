from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from agent import EXAMPLE_PROMPTS, CircuitAgent
from agent.netlist_generator import CircuitGenerationError
from agent.verifier import verify_spice_netlist
from models.circuit import AgentStep, CircuitRequest, VerifyRequest

ROOT_ENV_PATH = Path(__file__).parent.parent / ".env"
CURR_DIR_ENV_PATH = Path(__file__).parent / ".env"

if ROOT_ENV_PATH.exists():
    load_dotenv(dotenv_path=ROOT_ENV_PATH)
elif CURR_DIR_ENV_PATH.exists():
    load_dotenv(dotenv_path=CURR_DIR_ENV_PATH)
else:
    print(
        "Warning: No .env file found. Make sure to set environment variables appropriately."
    )

app = FastAPI(title="Circuit Builder Agent", version="0.1.0")
agent = CircuitAgent()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionManager:
    def __init__(self) -> None:
        self.active: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.active.discard(websocket)

    async def broadcast_step(self, step: AgentStep) -> None:
        dead: list[WebSocket] = []
        payload = {"type": "agent_step", "step": step.model_dump()}
        for websocket in self.active:
            try:
                await websocket.send_json(payload)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(websocket)


manager = ConnectionManager()


def generation_error_detail(message: str, step: str) -> dict[str, str]:
    return {
        "message": message,
        "step": step,
        "type": "circuit_generation_error",
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/circuit/generate")
async def generate_circuit(request: CircuitRequest):
    async def emit(step: AgentStep) -> None:
        await manager.broadcast_step(step)

    try:
        result = await agent.generate(request.prompt, progress=emit)
    except CircuitGenerationError as exc:
        raise HTTPException(
            status_code=422,
            detail=generation_error_detail(str(exc), "Generating Netlist"),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=generation_error_detail(str(exc), "Parsing"),
        ) from exc
    return result.model_dump(by_alias=True)


@app.get("/api/circuit/examples")
async def examples():
    return EXAMPLE_PROMPTS


@app.post("/api/circuit/verify")
async def verify_circuit(request: VerifyRequest):
    report = verify_spice_netlist(request.spice_netlist)
    return report.model_dump(by_alias=True)


@app.websocket("/ws/agent-stream")
async def agent_stream(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "generate" and message.get("prompt"):

                async def emit(step: AgentStep) -> None:
                    await websocket.send_json(
                        {"type": "agent_step", "step": step.model_dump()}
                    )

                try:
                    result = await agent.generate(str(message["prompt"]), progress=emit)
                except CircuitGenerationError as exc:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "error": generation_error_detail(
                                str(exc), "Generating Netlist"
                            ),
                        }
                    )
                except ValueError as exc:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "error": generation_error_detail(str(exc), "Parsing"),
                        }
                    )
                else:
                    await websocket.send_json(
                        {"type": "result", "result": result.model_dump(by_alias=True)}
                    )
            elif message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
