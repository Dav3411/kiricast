import os
import asyncio
import json
from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from pydantic import BaseModel
from supabase import create_client, Client as SupabaseClient

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_web_env_local():
    """제너레이터가 web/.env.local을 읽어 TTS_PROVIDER, ELEVENLABS_API_KEY 등이 적용되도록 함.

    - .env.local이 있을 때만 그 값으로 덮어쓴다. 파일이 없으면(예: Railway 배포) 기존 환경 변수를 유지.
    """
    path = os.path.join(BASE_DIR, "web", ".env.local")
    if not os.path.isfile(path):
        return
    _env_keys_to_override = [
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "TTS_PROVIDER",
        "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL",
        "GEMINI_API_KEY", "GOOGLE_API_KEY", "IMAGE_PROVIDER",
    ]
    for key in _env_keys_to_override:
        os.environ.pop(key, None)
    with open(path, "r", encoding="utf-8-sig") as f:  # utf-8-sig: BOM 제거
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, _, v = line.partition("=")
                k = k.strip().strip("\ufeff")  # BOM·앞뒤 공백 제거
                v = v.strip()
                if v.startswith('"') and v.endswith('"') or v.startswith("'") and v.endswith("'"):
                    v = v[1:-1]
                if k:
                    os.environ[k] = v


_load_web_env_local()
import podcast_maker
WEB_DIR = os.path.join(BASE_DIR, "web", "public")

# ---------------------------------------------------------------------------
# Supabase 클라이언트 (에이전트 직접 조회용)
# ---------------------------------------------------------------------------
_SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
_SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_SECRET_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    or os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    or ""
)
_supabase: SupabaseClient | None = None


def _get_supabase() -> SupabaseClient | None:
    """Supabase 클라이언트를 lazy-init으로 반환. 키가 없으면 None."""
    global _supabase
    if _supabase is not None:
        return _supabase
    if not _SUPABASE_URL or not _SUPABASE_KEY:
        return None
    _supabase = create_client(_SUPABASE_URL, _SUPABASE_KEY)
    return _supabase

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


class ScriptRequest(BaseModel):
    agent1_id: str
    agent2_id: str
    title: str
    setting: str = ""
    situation: str = ""
    core_emotion: str = ""
    relationship_state: str = ""
    tone: str = ""
    agent1: Optional[dict] = None
    agent2: Optional[dict] = None
    # 시리즈 연속 클립 컨텍스트
    series_context: Optional[list] = None
    arc_phase: Optional[str] = None
    episode_number: Optional[int] = None
    total_episodes: Optional[int] = None
    relationship_context: Optional[str] = None
    # 시리즈 파이프라인
    series_document: Optional[dict] = None
    arc_document: Optional[dict] = None
    language: Optional[str] = None


class CreateClipRequest(BaseModel):
    agent1_id: str
    agent2_id: str
    title: str
    setting: str = ""
    situation: str = ""
    core_emotion: str = ""
    relationship_state: str = ""
    tone: str = ""
    # 워커가 agents.json을 읽어 보내면 제너레이터는 파일 경로에 의존하지 않음 (Unknown agent id 방지)
    agent1: Optional[dict] = None
    agent2: Optional[dict] = None
    # 미리 생성된 대본을 전달하면 대본 재생성을 건너뜀
    script: Optional[list] = None
    # 시리즈 연속 클립 컨텍스트
    series_context: Optional[list] = None
    arc_phase: Optional[str] = None
    episode_number: Optional[int] = None
    total_episodes: Optional[int] = None
    relationship_context: Optional[str] = None
    # 시리즈 파이프라인 (시리즈 문서/아크 문서/3계층 메모리)
    series_document: Optional[dict] = None
    arc_document: Optional[dict] = None
    rolling_summary: Optional[str] = None
    core_memory: Optional[dict] = None
    character_fsm: Optional[dict] = None
    episode_type: Optional[str] = None
    episode_type_counts: Optional[dict] = None
    language: Optional[str] = None


class CreateAgentRequest(BaseModel):
    name: str
    concept: Optional[str] = None
    personality: Optional[str] = None
    speaking_style: Optional[str] = None
    appearance: Optional[str] = None
    intro_line: Optional[str] = None
    elevenlabs_voice_id: Optional[str] = None
    voice_candidates: Optional[list[dict]] = None
    # AI Assist로 미리 생성된 spec — 있으면 generate_agent_spec() 스킵
    pre_spec: Optional[dict] = None
    # 오토 서제스트: 이미 할당된 voice_id 목록 → 다른 목소리 선택
    already_used_voice_ids: Optional[list[str]] = None
    language: Optional[str] = None


class AssistRequest(BaseModel):
    name: Optional[str] = None
    concept: Optional[str] = None
    personality: Optional[str] = None
    speaking_style: Optional[str] = None
    appearance: Optional[str] = None
    introLine: Optional[str] = None


def _load_agents_map_merged():
    """Supabase agents 테이블에서 에이전트 맵을 로드하여 반환."""
    agents_map = {}
    sb = _get_supabase()
    if sb is not None:
        try:
            resp = sb.table("agents").select(
                "id, name, concept, personality, speaking_style, elevenlabs_voice_id, intro_line, image_key"
            ).execute()
            for row in (resp.data or []):
                agents_map[row["id"]] = {
                    "id": row["id"],
                    "name": row.get("name", ""),
                    "concept": row.get("concept", ""),
                    "personality": row.get("personality", ""),
                    "speaking_style": row.get("speaking_style", ""),
                    "elevenlabs_voice_id": row.get("elevenlabs_voice_id", ""),
                    "intro_line": row.get("intro_line", ""),
                    "image_key": row.get("image_key"),
                }
        except Exception as e:
            print(f"[warn] Supabase agents 조회 실패: {e}")

    if not agents_map:
        reasons = []
        if sb is None:
            reasons.append("Supabase not configured (SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY missing)")
        else:
            reasons.append("Supabase returned 0 agents")
        detail = "No agents available. " + "; ".join(reasons)
        raise FileNotFoundError(detail)

    return agents_map


def _get_agents_map_for_clip():
    """Load agents map and return (agents_map, source_desc, count). For logging and error details."""
    agents_map = _load_agents_map_merged()
    return agents_map, "Supabase", len(agents_map)


@app.get("/")
def root():
    if os.path.isdir(WEB_DIR):
        return RedirectResponse(url="/index.html")
    return {"ok": True, "service": "generator"}


def _resolve_agents_map(agent1_id, agent2_id, agent1=None, agent2=None):
    """agent1/agent2 객체가 있으면 사용, 없으면 파일/DB에서 로드."""
    if agent1 and agent2 and isinstance(agent1, dict) and isinstance(agent2, dict):
        a1_id = (agent1.get("id") or agent1_id or "").strip()
        a2_id = (agent2.get("id") or agent2_id or "").strip()
        if a1_id and a2_id:
            return {
                agent1_id: {**agent1, "id": agent1_id},
                agent2_id: {**agent2, "id": agent2_id},
            }
    agents_map, path_used, count = _get_agents_map_for_clip()
    missing = [aid for aid in (agent1_id, agent2_id) if aid not in agents_map]
    if missing:
        sample_ids = list(agents_map.keys())[:15]
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown agent id: {', '.join(missing)}. "
                f"Loaded {count} agents from {path_used}. "
                f"Sample ids: {sample_ids!r}"
            ),
        )
    return agents_map


@app.post("/api/clips/script")
async def generate_script_only(req: ScriptRequest):
    """대본만 생성 (무료). 오디오 생성 없이 대본 JSON을 반환한다."""
    if req.agent1_id == req.agent2_id:
        raise HTTPException(status_code=400, detail="agent1_id and agent2_id must be different")

    try:
        agents_map = _resolve_agents_map(req.agent1_id, req.agent2_id, req.agent1, req.agent2)
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    host1 = agents_map[req.agent1_id]
    host2 = agents_map[req.agent2_id]

    series_kwargs = {}
    if req.series_context and req.episode_number:
        series_kwargs = dict(
            series_context=req.series_context, arc_phase=req.arc_phase,
            episode_number=req.episode_number, total_episodes=req.total_episodes,
            relationship_context=req.relationship_context,
        )

    try:
        lines = podcast_maker.generate_clip_script(
            host1, host2, req.title,
            setting=req.setting, situation=req.situation,
            core_emotion=req.core_emotion, relationship_state=req.relationship_state, tone=req.tone,
            language=req.language,
            **series_kwargs,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Script generation failed: {e}")

    return {"ok": True, "script": lines}


@app.post("/api/clips/create")
async def create_clip(req: CreateClipRequest):
    if req.agent1_id == req.agent2_id:
        raise HTTPException(status_code=400, detail="agent1_id and agent2_id must be different")

    try:
        agents_map = _resolve_agents_map(req.agent1_id, req.agent2_id, req.agent1, req.agent2)
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    print(f"[clips/create] ids: {req.agent1_id}, {req.agent2_id}, script={'provided' if req.script else 'generate'}")

    try:
        series_kwargs = {}
        if req.series_context is not None and req.episode_number:
            series_kwargs = dict(
                series_context=req.series_context, arc_phase=req.arc_phase,
                episode_number=req.episode_number, total_episodes=req.total_episodes,
                relationship_context=req.relationship_context,
            )
        # 시리즈 파이프라인 확장 (문서/메모리)
        if req.series_document:
            series_kwargs["series_document"] = req.series_document
        if req.arc_document:
            series_kwargs["arc_document"] = req.arc_document
        if req.rolling_summary is not None:
            series_kwargs["rolling_summary"] = req.rolling_summary
        if req.core_memory is not None:
            series_kwargs["core_memory"] = req.core_memory
        if req.character_fsm is not None:
            series_kwargs["character_fsm"] = req.character_fsm
        if req.episode_type:
            series_kwargs["episode_type"] = req.episode_type
        if req.episode_type_counts is not None:
            series_kwargs["episode_type_counts"] = req.episode_type_counts
        if req.language:
            series_kwargs["language"] = req.language
        meta = await podcast_maker.produce_clip(
            title=req.title,
            agent1_id=req.agent1_id,
            agent2_id=req.agent2_id,
            agents_map=agents_map,
            script=req.script,
            setting=req.setting,
            situation=req.situation,
            core_emotion=req.core_emotion,
            relationship_state=req.relationship_state,
            tone=req.tone,
            **series_kwargs,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        err_msg = str(e)
        # OpenAI API 키 오류 등 민감/노이즈 메시지를 사용자용 안내로 대체 (Supabase job.error에 기록됨)
        if "invalid_api_key" in err_msg or "Incorrect API key" in err_msg or (
            "Error code: 401" in err_msg and "API key" in err_msg
        ):
            raise HTTPException(
                status_code=500,
                detail="API key is invalid.",
            )
        # ffmpeg/ffprobe not found (Linux Errno 2, Windows WinError 2)
        if isinstance(e, FileNotFoundError) or "WinError 2" in err_msg or "Errno 2" in err_msg or (
            "cannot find the file specified" in err_msg or "No such file or directory" in err_msg
        ):
            raise HTTPException(
                status_code=500,
                detail="FFmpeg not found. Install FFmpeg and add it to PATH (https://ffmpeg.org/download.html). Windows: extract and add the bin folder to System PATH.",
            )
        raise HTTPException(status_code=500, detail=f"Failed to produce clip: {e}")

    return {
        "ok": True,
        "clip": meta,
    }


class AgentPayload(BaseModel):
    id: str
    name: str = ""
    avatar_url: str | None = None
    dominant_color: str | None = None

class ExportShortsRequest(BaseModel):
    mp3_url: str
    json_url: str
    title: str = "Untitled"
    agents: list[AgentPayload] = []
    no_watermark: bool = False
    bg_image_url: str | None = None


@app.post("/api/clips/export-shorts")
async def export_shorts(req: ExportShortsRequest):
    """Download from R2 signed URLs and produce a 1080x1920 shorts MP4."""
    import tempfile
    import shutil

    tmp_dir = tempfile.mkdtemp(prefix="shorts_")
    os.chmod(tmp_dir, 0o700)
    try:
        # MP3 다운로드
        mp3_path = os.path.join(tmp_dir, "clip.mp3")
        _download_url(req.mp3_url, mp3_path)

        # Transcript JSON 다운로드
        json_path = os.path.join(tmp_dir, "clip.json")
        _download_url(req.json_url, json_path)

        # 에이전트 아바타 다운로드
        agents_map = {}
        avatar_paths = {}
        for agent in req.agents:
            aid = agent.id
            if not aid:
                continue
            agents_map[aid] = {"name": agent.name or aid, "dominant_color": agent.dominant_color}
            avatar_url = agent.avatar_url
            if avatar_url:
                ext = ".png"
                av_path = os.path.join(tmp_dir, f"avatar_{aid}{ext}")
                try:
                    _download_url(avatar_url, av_path)
                    if os.path.isfile(av_path) and os.path.getsize(av_path) > 0:
                        avatar_paths[aid] = av_path
                except Exception:
                    pass

        # 배경 이미지 다운로드
        bg_image_path = None
        if req.bg_image_url:
            try:
                bg_image_path = os.path.join(tmp_dir, "bg.png")
                _download_url(req.bg_image_url, bg_image_path)
                if not os.path.isfile(bg_image_path) or os.path.getsize(bg_image_path) == 0:
                    bg_image_path = None
            except Exception:
                bg_image_path = None

        # 출력 MP4
        output_mp4 = os.path.join(tmp_dir, "output.mp4")

        mp4_path = podcast_maker.export_clip_shorts(
            mp3_path=mp3_path,
            json_path=json_path,
            output_mp4=output_mp4,
            agents_map=agents_map,
            avatar_paths=avatar_paths,
            no_watermark=req.no_watermark,
            bg_image_path=bg_image_path,
        )

        # FileResponse로 MP4 반환 (임시 디렉토리는 응답 후 삭제)
        from starlette.responses import FileResponse
        from starlette.background import BackgroundTask

        def cleanup():
            shutil.rmtree(tmp_dir, ignore_errors=True)

        return FileResponse(
            mp4_path,
            media_type="video/mp4",
            filename=f"{req.title or 'shorts'}.mp4",
            background=BackgroundTask(cleanup),
        )

    except FileNotFoundError as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        err_msg = str(e)
        if "ffmpeg" in err_msg and ("No such file or directory" in err_msg or "Errno 2" in err_msg):
            raise HTTPException(
                status_code=500,
                detail="ffmpeg is not installed. Local: Mac use brew install ffmpeg, Windows install from ffmpeg.org and add to PATH. Railway: see nixpacks.toml at project root.",
            )
        raise HTTPException(status_code=500, detail=f"Export failed: {e}")


def _validate_download_url(url: str) -> None:
    """SSRF 방어: http(s)만 허용, 내부 IP 차단."""
    from urllib.parse import urlparse
    import ipaddress
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")
    hostname = parsed.hostname or ""
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            raise ValueError(f"Internal IP not allowed: {ip}")
    except ValueError as e:
        if "not allowed" in str(e):
            raise


def _download_url(url: str, dest: str):
    """URL에서 파일을 다운로드."""
    _validate_download_url(url)
    import urllib.request
    urllib.request.urlretrieve(url, dest)
    if not os.path.isfile(dest) or os.path.getsize(dest) == 0:
        raise FileNotFoundError(f"Download failed: {url}")


_voices_cache: dict = {"account": None, "shared": None, "ts": 0}
_VOICES_CACHE_TTL = 600  # 10분 캐시

_ENGLISH_ACCENTS = {
    "american", "british", "australian", "canadian", "irish", "scottish",
    "english", "american-southern", "transatlantic", "welsh", "new zealand"
}


def _filter_english_voices(voices):
    """영어권 accent만 필터링."""
    result = []
    for v in voices:
        accent = (v.get("accent") or "").lower().strip()
        if not accent or accent in _ENGLISH_ACCENTS:
            result.append(v)
    return result


def _fetch_account_voices(api_key):
    """계정 voice (premade + 내 voice) 가져오기. 빠름."""
    raw_voices = None

    EL = getattr(podcast_maker, "ElevenLabs", None)
    try:
        if EL is None:
            raise ImportError("ElevenLabs SDK not available")
        client = EL(api_key=api_key)

        def _extract(v):
            labels = getattr(v, "labels", None) or {}
            return {
                "voice_id": v.voice_id,
                "name": v.name,
                "category": getattr(v, "category", None),
                "gender": labels.get("gender"),
                "accent": labels.get("accent"),
                "age": labels.get("age"),
                "description": labels.get("description") or getattr(v, "description", None),
                "preview_url": getattr(v, "preview_url", None),
            }

        raw_voices = []
        page_token = None
        for _ in range(50):
            kwargs = {"page_size": 100}
            if page_token:
                kwargs["next_page_token"] = page_token
            result = client.voices.search(**kwargs)
            for v in (result.voices or []):
                raw_voices.append(_extract(v))
            if not getattr(result, "has_more", False):
                break
            page_token = getattr(result, "next_page_token", None)
            if not page_token:
                break
        print(f"[voices] SDK returned {len(raw_voices)} account voices")
    except Exception as sdk_err:
        print(f"[voices] SDK failed: {sdk_err}")
        raw_voices = None

    if raw_voices is None:
        import urllib.request as _ur
        req = _ur.Request(
            "https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": api_key, "Accept": "application/json"},
        )
        try:
            with _ur.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            raw_voices = []
            for v in data.get("voices", []):
                labels = v.get("labels") or {}
                raw_voices.append({
                    "voice_id": v.get("voice_id"),
                    "name": v.get("name"),
                    "category": v.get("category"),
                    "gender": labels.get("gender"),
                    "accent": labels.get("accent"),
                    "age": labels.get("age"),
                    "description": labels.get("description") or v.get("description"),
                    "preview_url": v.get("preview_url"),
                })
        except Exception as e:
            print(f"[voices] urllib fallback failed: {e}")
            raw_voices = None

    if raw_voices is None:
        print("[voices] Using hardcoded premade voice list")
        raw_voices = [
            {"voice_id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel", "category": "premade", "gender": "female", "accent": "american", "age": "young", "description": "Calm and warm, great for narration", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/21m00Tcm4TlvDq8ikWAM/df6788f9-5c96-470d-8571-1c3b0c4c37f8.mp3"},
            {"voice_id": "AZnzlk1XvdvUeBnXmlld", "name": "Domi", "category": "premade", "gender": "female", "accent": "american", "age": "young", "description": "Strong and confident", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/AZnzlk1XvdvUeBnXmlld/69c5373f-0dc2-4efd-9232-a0140182c0a9.mp3"},
            {"voice_id": "EXAVITQu4vr4xnSDxMaL", "name": "Bella", "category": "premade", "gender": "female", "accent": "american", "age": "young", "description": "Soft and expressive", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/04b81495-82a0-4c7b-b900-1be2f580033b.mp3"},
            {"voice_id": "ErXwobaYiN019PkySvjV", "name": "Antoni", "category": "premade", "gender": "male", "accent": "american", "age": "young", "description": "Well-rounded and crisp", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/ErXwobaYiN019PkySvjV/38d8f8f0-1122-4333-b323-0b87478d506a.mp3"},
            {"voice_id": "MF3mGyEYCl7XYWbV9V6O", "name": "Elli", "category": "premade", "gender": "female", "accent": "american", "age": "young", "description": "Emotional and clear", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/MF3mGyEYCl7XYWbV9V6O/d8539cbe-91c6-4ae9-80c8-4a12ed3a8e1a.mp3"},
            {"voice_id": "TxGEqnHWrfWFTfGW9XjX", "name": "Josh", "category": "premade", "gender": "male", "accent": "american", "age": "young", "description": "Deep and energetic", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/TxGEqnHWrfWFTfGW9XjX/e0a20bab-6f67-42da-a1f0-445726a1780e.mp3"},
            {"voice_id": "VR6AewLTigWG4xSOukaG", "name": "Arnold", "category": "premade", "gender": "male", "accent": "american", "age": "middle aged", "description": "Crisp and authoritative", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/VR6AewLTigWG4xSOukaG/3cca2a4b-e072-4eab-93c7-0e1508b0753e.mp3"},
            {"voice_id": "pNInz6obpgDQGcFmaJgB", "name": "Adam", "category": "premade", "gender": "male", "accent": "american", "age": "middle aged", "description": "Deep, calm, narration", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/e7b9a6b0-1570-4333-b3d0-3e70c0e2b386.mp3"},
            {"voice_id": "yoZ06aMxZJJ28mfd3POQ", "name": "Sam", "category": "premade", "gender": "male", "accent": "american", "age": "young", "description": "Raspy and dynamic", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/yoZ06aMxZJJ28mfd3POQ/b017ad02-8d4a-4b9e-9f5c-ef0e8703a842.mp3"},
            {"voice_id": "onwK4e9ZLuTAKqWW03F9", "name": "Daniel", "category": "premade", "gender": "male", "accent": "british", "age": "middle aged", "description": "Authoritative and deep", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/onwK4e9ZLuTAKqWW03F9/e4b994b7-9713-47e1-a0e0-18a91ef6e4fe.mp3"},
            {"voice_id": "XB0fDUnXU5powFXDhCwa", "name": "Charlotte", "category": "premade", "gender": "female", "accent": "swedish", "age": "middle aged", "description": "Seductive and calm", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/XB0fDUnXU5powFXDhCwa/942356dc-f10d-4d89-bda5-4f8505ee038b.mp3"},
            {"voice_id": "Xb7hH8MSUJpSbSDYk0k2", "name": "Alice", "category": "premade", "gender": "female", "accent": "british", "age": "middle aged", "description": "Confident and warm", "preview_url": "https://storage.googleapis.com/eleven-public-prod/premade/voices/Xb7hH8MSUJpSbSDYk0k2/2e4a5d4b-0351-4735-a9e5-3c1578c7dbf8.mp3"},
            {"voice_id": "iP95p4xoKVk53GoZ742B", "name": "Chris", "category": "premade", "gender": "male", "accent": "american", "age": "middle aged", "description": "Casual and conversational", "preview_url": None},
            {"voice_id": "nPczCjzI2devNBz1zQrb", "name": "Brian", "category": "premade", "gender": "male", "accent": "american", "age": "middle aged", "description": "Deep narration voice", "preview_url": None},
            {"voice_id": "N2lVS1w4EtoT3dr4eOWO", "name": "Callum", "category": "premade", "gender": "male", "accent": "transatlantic", "age": "middle aged", "description": "Intense and hoarse", "preview_url": None},
            {"voice_id": "TX3LPaxmHKxFdv7VOQHJ", "name": "Liam", "category": "premade", "gender": "male", "accent": "american", "age": "young", "description": "Articulate and confident", "preview_url": None},
            {"voice_id": "XrExE9yKIg1WjnnlVkGX", "name": "Lily", "category": "premade", "gender": "female", "accent": "british", "age": "middle aged", "description": "Warm and authoritative", "preview_url": None},
            {"voice_id": "pFZP5JQG7iQjIQuC4Bku", "name": "George", "category": "premade", "gender": "male", "accent": "british", "age": "middle aged", "description": "Warm and raspy", "preview_url": None},
            {"voice_id": "bIHbv24MWmeRgasZH58o", "name": "Will", "category": "premade", "gender": "male", "accent": "american", "age": "young", "description": "Friendly and warm", "preview_url": None},
            {"voice_id": "cgSgspJ2msm6clMCkdW9", "name": "Jessica", "category": "premade", "gender": "female", "accent": "american", "age": "young", "description": "Expressive and upbeat", "preview_url": None},
            {"voice_id": "cjVigY5qzO86Huf0OWal", "name": "Eric", "category": "premade", "gender": "male", "accent": "american", "age": "middle aged", "description": "Friendly and calm", "preview_url": None},
            {"voice_id": "FGY2WhTYpPnrIDTdsKH5", "name": "Laura", "category": "premade", "gender": "female", "accent": "american", "age": "young", "description": "Upbeat and clear", "preview_url": None},
            {"voice_id": "IKne3meq5aSn9XLyUdCD", "name": "Charlie", "category": "premade", "gender": "male", "accent": "australian", "age": "young", "description": "Natural and casual", "preview_url": None},
            {"voice_id": "JBFqnCBsd6RMkjVDRZzb", "name": "George (Classic)", "category": "premade", "gender": "male", "accent": "british", "age": "middle aged", "description": "Warm narration", "preview_url": None},
            {"voice_id": "CxErO97xpQgQXYmapDKX", "name": "River", "category": "premade", "gender": "non-binary", "accent": "american", "age": "young", "description": "Confident and smooth", "preview_url": None},
            {"voice_id": "jsCqWAovK2LkecY7zXl4", "name": "Freya", "category": "premade", "gender": "female", "accent": "american", "age": "young", "description": "Expressive, overly dramatic", "preview_url": None},
            {"voice_id": "oWAxZDx7w5VEj9dCyTzz", "name": "Grace", "category": "premade", "gender": "female", "accent": "american-southern", "age": "young", "description": "Southern, gentle", "preview_url": None},
            {"voice_id": "g5CIjZEefAph4nQFvHAz", "name": "Ethan", "category": "premade", "gender": "male", "accent": "american", "age": "young", "description": "Soft, ASMR-like", "preview_url": None},
            {"voice_id": "ThT5KcBeYPX3keUQqHPh", "name": "Dorothy", "category": "premade", "gender": "female", "accent": "british", "age": "young", "description": "Pleasant, bright", "preview_url": None},
            {"voice_id": "t0jbNlBVZ17f02VDIeMI", "name": "Matilda", "category": "premade", "gender": "female", "accent": "american", "age": "middle aged", "description": "Warm, friendly", "preview_url": None},
            {"voice_id": "GBv7mTt0atIp3Br8iCZE", "name": "Thomas", "category": "premade", "gender": "male", "accent": "american", "age": "young", "description": "Calm, steady", "preview_url": None},
            {"voice_id": "SOYHLrjzK2X1ezoPC6cr", "name": "Harry", "category": "premade", "gender": "male", "accent": "american", "age": "young", "description": "Anxious, fast", "preview_url": None},
            {"voice_id": "2EiwWnXFnvU5JabPnv8n", "name": "Clyde", "category": "premade", "gender": "male", "accent": "american", "age": "middle aged", "description": "War veteran, gruff", "preview_url": None},
            {"voice_id": "flq6f7yk4E4fJM5XTYuZ", "name": "Michael", "category": "premade", "gender": "male", "accent": "american", "age": "old", "description": "Older, distinguished", "preview_url": None},
        ]

    return raw_voices


@app.get("/api/voices")
async def list_voices():
    """계정 voice만 빠르게 반환 (캐시됨)."""
    import time as _time
    now = _time.time()
    if _voices_cache["account"] is not None and (now - _voices_cache["ts"]) < _VOICES_CACHE_TTL:
        return {"voices": _voices_cache["account"], "has_more": True}

    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY not configured")

    account_voices = _fetch_account_voices(api_key)

    _voices_cache["account"] = account_voices
    _voices_cache["ts"] = now
    _voices_cache["shared"] = None  # shared 캐시 리셋

    return {"voices": account_voices, "has_more": True}


@app.get("/api/voices/shared")
async def list_shared_voices(page: int = 0):
    """공유 voice를 페이지 단위로 반환. page_size=100."""
    import time as _time
    import urllib.request as _ur

    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY not configured")

    # 캐시에서 이미 계정 voice id 가져오기 (중복 제거용)
    account_ids = set()
    if _voices_cache["account"]:
        account_ids = {v["voice_id"] for v in _voices_cache["account"]}

    url = f"https://api.elevenlabs.io/v1/shared-voices?page_size=100&page={page}&sort=trending"
    req = _ur.Request(url, headers={"xi-api-key": api_key, "Accept": "application/json"})
    try:
        with _ur.urlopen(req, timeout=15) as resp:
            sdata = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[voices/shared] page {page} failed: {e}")
        return {"voices": [], "has_more": False, "page": page}

    voices_list = sdata.get("voices", [])
    new_voices = []
    for sv in voices_list:
        vid = sv.get("voice_id") or sv.get("public_owner_id", "")
        if not vid or vid in account_ids:
            continue
        new_voices.append({
            "voice_id": vid,
            "name": sv.get("name", ""),
            "category": sv.get("category") or "shared",
            "gender": sv.get("gender"),
            "accent": sv.get("accent"),
            "age": sv.get("age"),
            "description": sv.get("description"),
            "preview_url": sv.get("preview_url"),
        })

    has_more = sdata.get("has_more", len(voices_list) >= 100)

    return {"voices": new_voices, "has_more": has_more, "page": page}


@app.post("/api/agents/assist")
async def assist_agent(req: AssistRequest):
    """AI로 에이전트 필드를 보강/생성 (이미지·TTS 없이 스펙만)"""
    name = (req.name or "").strip() or "Unnamed"
    concept = (req.concept or "").strip() or None
    personality = (req.personality or "").strip() or None
    if not concept and not personality:
        raise HTTPException(status_code=400, detail="At least concept or personality required")
    try:
        spec = podcast_maker.generate_agent_spec(
            name,
            concept=concept,
            personality=personality,
            speaking_style=(req.speaking_style or "").strip() or None,
            appearance=(req.appearance or "").strip() or None,
        )
        return {"ok": True, "result": spec}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Assist failed: {e}")


class ClipAssistRequest(BaseModel):
    title: str = ""
    setting: str = ""
    situation: str = ""
    core_emotion: str = ""
    relationship_state: str = ""
    tone: str = ""
    agent1_id: str = ""
    agent2_id: str = ""
    agent1: Optional[dict] = None
    agent2: Optional[dict] = None


@app.post("/api/clips/assist")
async def assist_clip(req: ClipAssistRequest):
    """AI로 클립의 Title/Setting/Situation/Core Emotion/Relationship State/Tone을 보강/생성"""
    title = req.title.strip()

    # 에이전트 정보 resolve
    host1 = None
    host2 = None
    if req.agent1 and req.agent2:
        host1 = req.agent1
        host2 = req.agent2
    elif req.agent1_id and req.agent2_id:
        try:
            agents_map = _resolve_agents_map(req.agent1_id, req.agent2_id)
            host1 = agents_map.get(req.agent1_id)
            host2 = agents_map.get(req.agent2_id)
        except Exception:
            pass  # 에이전트 없어도 assist는 동작

    try:
        result = podcast_maker.generate_clip_assist(
            title=title,
            setting=req.setting.strip() or None,
            situation=req.situation.strip() or None,
            core_emotion=req.core_emotion.strip() or None,
            relationship_state=req.relationship_state.strip() or None,
            tone=req.tone.strip() or None,
            host1=host1,
            host2=host2,
        )
        return {"ok": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clip assist failed: {e}")


@app.post("/api/agents/create")
async def create_agent(req: CreateAgentRequest):
    concept = (req.concept or "").strip() or None
    personality = (req.personality or "").strip() or None
    if not req.name.strip() or (not concept and not personality):
        raise HTTPException(status_code=400, detail="name and at least one of concept/personality required")

    try:
        agent = await podcast_maker.produce_agent(
            name=req.name.strip(),
            concept=concept,
            personality=personality,
            speaking_style=req.speaking_style.strip() if req.speaking_style else None,
            appearance=req.appearance.strip() if req.appearance else None,
            intro_line=req.intro_line.strip() if req.intro_line else None,
            elevenlabs_voice_id=req.elevenlabs_voice_id.strip() if req.elevenlabs_voice_id else None,
            voice_candidates=req.voice_candidates,
            pre_spec=req.pre_spec,
            already_used_voice_ids=req.already_used_voice_ids,
            language=req.language.strip() if req.language else None,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        err_msg = str(e)
        if "invalid_api_key" in err_msg or "Incorrect API key" in err_msg or (
            "Error code: 401" in err_msg and "API key" in err_msg
        ):
            raise HTTPException(
                status_code=500,
                detail="OpenAI API key is invalid. Check OPENAI_API_KEY in the Generator environment.",
            )
        raise HTTPException(status_code=500, detail=f"Failed to produce agent: {e}")

    # bytes 필드를 base64로 변환하여 JSON 전송 (로컬 파일 저장 없음)
    import base64 as _b64
    image_bytes = agent.pop("image_bytes", None)
    intro_mp3_bytes = agent.pop("intro_mp3_bytes", None)
    if image_bytes:
        agent["image_b64"] = _b64.b64encode(image_bytes).decode("ascii")
    if intro_mp3_bytes:
        agent["intro_mp3_b64"] = _b64.b64encode(intro_mp3_bytes).decode("ascii")

    return {
        "ok": True,
        "agent": agent,
    }


# ==========================================
# 시리즈 문서 / 시나리오 엔드포인트
# ==========================================

class GenerateSeriesDocRequest(BaseModel):
    agent1_id: Optional[str] = None
    agent2_id: Optional[str] = None
    idea: str
    auto_generate_agents: bool = False
    agent1: Optional[dict] = None
    agent2: Optional[dict] = None
    language: Optional[str] = None


@app.post("/api/series/generate-document")
async def generate_series_doc(req: GenerateSeriesDocRequest):
    """에이전트 카드 + 아이디어로 시리즈 문서 + 아크 문서를 생성. auto_generate_agents=True거나 두 id가 비어 있으면 idea만으로 생성하고 proposed_agents 반환."""
    idea = (req.idea or "").strip()
    if not idea:
        raise HTTPException(status_code=400, detail="idea is required")

    agent1_id = (req.agent1_id or "").strip()
    agent2_id = (req.agent2_id or "").strip()
    use_auto_agents = req.auto_generate_agents or (not agent1_id and not agent2_id)

    if use_auto_agents:
        try:
            result = podcast_maker.generate_series_and_arc_document_from_idea(idea, language=req.language)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Series document generation failed: {e}")
        return {
            "ok": True,
            "series_title": result.get("series_title", ""),
            "series_document": result["series_document"],
            "arc_document": result["arc_document"],
            "proposed_agents": result.get("proposed_agents", []),
        }

    if not agent1_id or not agent2_id:
        raise HTTPException(status_code=400, detail="agent1_id and agent2_id are required when auto_generate_agents is false")

    try:
        agents_map = _resolve_agents_map(agent1_id, agent2_id, req.agent1, req.agent2)
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    host1 = agents_map[agent1_id]
    host2 = agents_map[agent2_id]

    try:
        result = podcast_maker.generate_series_and_arc_document(host1, host2, idea, language=req.language)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Series document generation failed: {e}")

    return {"ok": True, "series_title": result.get("series_title", ""), "series_document": result["series_document"], "arc_document": result["arc_document"]}


class RefineSeriesDocRequest(BaseModel):
    series_document: dict
    arc_document: dict
    instruction: str
    series_title: Optional[str] = None


@app.post("/api/series/refine-document")
async def refine_series_doc(req: RefineSeriesDocRequest):
    """유저의 수정 요청에 따라 시리즈/아크 문서를 수정."""
    try:
        result = podcast_maker.refine_series_document(req.series_document, req.arc_document, req.instruction, series_title=req.series_title)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document refinement failed: {e}")

    return {"ok": True, "series_title": result.get("series_title", ""), "series_document": result["series_document"], "arc_document": result["arc_document"]}


class GenerateScenarioRequest(BaseModel):
    agent1_id: str
    agent2_id: str
    series_document: dict
    arc_document: dict
    episode_number: int = 1
    user_choice: Optional[str] = None
    agent1: Optional[dict] = None
    agent2: Optional[dict] = None
    story_context: Optional[list] = None
    character_fsm: Optional[dict] = None
    rolling_summary: Optional[str] = None
    core_memory: Optional[dict] = None
    language: Optional[str] = None


@app.post("/api/series/generate-scenario")
async def generate_scenario_endpoint(req: GenerateScenarioRequest):
    """시나리오 생성 + 검증."""
    try:
        agents_map = _resolve_agents_map(req.agent1_id, req.agent2_id, req.agent1, req.agent2)
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    host1 = agents_map[req.agent1_id]
    host2 = agents_map[req.agent2_id]

    try:
        scenario = podcast_maker.generate_and_validate_scenario(
            host1, host2, req.series_document, req.arc_document,
            story_context=req.story_context, episode_number=req.episode_number,
            user_choice=req.user_choice,
            character_fsm=req.character_fsm,
            rolling_summary=req.rolling_summary, core_memory=req.core_memory,
            language=req.language,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scenario generation failed: {e}")

    return {"ok": True, "scenario": scenario}


if os.path.isdir(WEB_DIR):
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    tts = getattr(podcast_maker, "TTS_PROVIDER", "openai").strip().lower()
    tts_label = "ElevenLabs" if tts == "elevenlabs" else "OpenAI"
    sb_status = "connected" if _get_supabase() else "not configured"
    openai_len = len(os.environ.get("OPENAI_API_KEY", ""))
    eleven_len = len(os.environ.get("ELEVENLABS_API_KEY", ""))
    print(f"Generator env: OPENAI_API_KEY={'set (len=%d)' % openai_len if openai_len else 'not set'}, ELEVENLABS_API_KEY={'set (len=%d)' % eleven_len if eleven_len else 'not set'}")
    try:
        _, source, n = _get_agents_map_for_clip()
        print(f"Generator starting | TTS engine: {tts_label} (TTS_PROVIDER={tts}) | Supabase: {sb_status} | agents: {n} from {source}")
    except Exception as e:
        print(f"Generator starting | TTS engine: {tts_label} (TTS_PROVIDER={tts}) | Supabase: {sb_status} | agents load failed: {e}")
    host = os.environ.get("GENERATOR_HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=8787)
