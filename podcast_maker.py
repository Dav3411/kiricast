import asyncio
import json
import os
import random
import re
import subprocess
import sys
import uuid
import base64
import urllib.error
import urllib.request
import time
import tempfile
import shutil
from PIL import Image, ImageDraw, ImageFont
from openai import OpenAI

# Windows: cp949 콘솔이 '—' 등 유니코드 출력 시 실패하지 않도록 stdout/stderr를 UTF-8로 고정
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    import anthropic as _anthropic_module
except Exception:
    _anthropic_module = None

try:
    from elevenlabs.client import ElevenLabs  # type: ignore
except Exception:
    ElevenLabs = None

# ==========================================
# 언어 코드 → 언어 이름 매핑
# ==========================================
_LANG_NAMES = {"en": "English", "ko": "Korean", "ja": "Japanese", "zh": "Chinese", "es": "Spanish"}

def _lang_name(code):
    """Map ISO 639-1 code to full language name for LLM prompts."""
    return _LANG_NAMES.get(code or "en", "English")

def _lang_directive(language):
    """Return a language directive string for LLM system prompts."""
    name = _lang_name(language)
    return f"Write ALL text in {name}." if language and language != "en" else "Write ALL text in English."

# ==========================================
# 폰트 경로 탐색 (FFmpeg fontfile / Pillow truetype용)
# ==========================================
_FONT_SEARCH_DIRS = [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    os.path.expanduser("~/.fonts"),
    os.path.expanduser("~/.local/share/fonts"),
    "C:/Windows/Fonts",
    os.path.join(os.path.dirname(__file__), "fonts"),  # 프로젝트 번들 폰트
]

def _find_font(names: list[str]) -> str | None:
    """시스템에서 폰트 파일을 찾아 절대 경로 반환. 없으면 None."""
    for d in _FONT_SEARCH_DIRS:
        if not os.path.isdir(d):
            continue
        for root, _, files in os.walk(d):
            for fn in files:
                if fn.lower() in [n.lower() for n in names]:
                    return os.path.join(root, fn)
    return None

# 시작 시 한 번만 탐색
def _norm(p: str | None) -> str | None:
    """경로 구분자를 /로 정규화 (Pillow 등 일반 용도)."""
    return p.replace("\\", "/") if p else None

def _ffp(p: str | None) -> str | None:
    """FFmpeg filter option 값 안에서 쓸 경로: / 정규화 + 콜론 이스케이프 (Windows C: 대응)."""
    if not p:
        return None
    return p.replace("\\", "/").replace(":", "\\:")

NOTO_SANS_PATH = _norm(_find_font(["NotoSansKR-Regular.ttf", "NotoSansKR-Medium.ttf", "NotoSansKR-Bold.ttf",
                                    "NotoSans-Regular.ttf", "NotoSans-Medium.ttf", "NotoSans-Bold.ttf"]))
NOTO_SANS_BOLD_PATH = _norm(_find_font(["NotoSansKR-Bold.ttf", "NotoSansKR-SemiBold.ttf", "NotoSansKR-Medium.ttf",
                                         "NotoSans-Bold.ttf", "NotoSans-Medium.ttf", "NotoSans-Regular.ttf"]))
POPPINS_PATH = _norm(_find_font(["Poppins-Medium.ttf", "Poppins-Regular.ttf", "Poppins-Bold.ttf"]))

print(f"[fonts] NOTO_SANS_PATH      = {NOTO_SANS_PATH}")
print(f"[fonts] NOTO_SANS_BOLD_PATH = {NOTO_SANS_BOLD_PATH}")
print(f"[fonts] POPPINS_PATH        = {POPPINS_PATH}")
if not NOTO_SANS_PATH:
    print("[fonts] WARNING: Noto Sans KR not found — subtitles/names may use fallback font")
if not POPPINS_PATH:
    print("[fonts] WARNING: Poppins not found — KIRICAST logo may use fallback font")

# ==========================================
# 1. 설정 (여기에 API 키를 입력하세요!)
# ==========================================
API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
IMAGE_PROVIDER = os.getenv("IMAGE_PROVIDER", "openai").strip().lower()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
GEMINI_IMAGE_MODEL = os.getenv("GEMINI_IMAGE_MODEL", "imagen-3.0-generate-002")  # Imagen | gemini-2.5-flash-image (Nano Banana) | gemini-3-pro-image-preview (Nano Banana Pro)
# TTS: "openai" (GPT) | "elevenlabs" — 에이전트 인트로·클립 라인 모두 동일 프로바이더 사용
TTS_PROVIDER = os.getenv("TTS_PROVIDER", "openai").strip().lower()
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")  # 기본 음성 (전체 공통)
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
# 선택: 에이전트별 voice_id. JSON 문자열 예: {"en-US-ChristopherNeural":"abc","nova":"def"}
# 비어 있으면 아래 ELEVENLABS_DEFAULT_VOICE_MAP(에이전트 성격별 기본 음성) 사용
ELEVENLABS_VOICE_ID_MAP = os.getenv("ELEVENLABS_VOICE_ID_MAP", "")

# FFmpeg 경로 (Windows: .env.local의 FFMPEG_BIN 또는 winget 설치 경로 자동 탐색)
def _resolve_ffmpeg():
    env_bin = os.environ.get("FFMPEG_BIN", "").strip()
    if env_bin:
        env_bin = os.path.normpath(env_bin.replace("/", os.sep))
        exe = os.path.join(env_bin, "ffmpeg.exe") if sys.platform == "win32" else os.path.join(env_bin, "ffmpeg")
        if os.path.isfile(exe):
            return env_bin
    if sys.platform == "win32":
        # winget Gyan.FFmpeg 설치 경로 탐색 (PATH 미반영 프로세스용)
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            winget = os.path.join(local, "Microsoft", "WinGet", "Packages")
            if os.path.isdir(winget):
                try:
                    for name in os.listdir(winget):
                        if name.startswith("Gyan.FFmpeg"):
                            pkg = os.path.join(winget, name)
                            for root, _, files in os.walk(pkg):
                                if "ffmpeg.exe" in files:
                                    return root
                            break
                except OSError:
                    pass
        # PATH에서 찾기 (이 프로세스에 PATH가 있다면)
        which = shutil.which("ffmpeg")
        if which:
            return os.path.dirname(which)
    return None

_FFMPEG_BIN = _resolve_ffmpeg()
if _FFMPEG_BIN:
    _FFMPEG_CMD = os.path.join(_FFMPEG_BIN, "ffmpeg.exe") if sys.platform == "win32" else os.path.join(_FFMPEG_BIN, "ffmpeg")
    _FFPROBE_CMD = os.path.join(_FFMPEG_BIN, "ffprobe.exe") if sys.platform == "win32" else os.path.join(_FFMPEG_BIN, "ffprobe")
else:
    _FFMPEG_CMD = "ffmpeg"
    _FFPROBE_CMD = "ffprobe"

# 에이전트 voice 이름 → ElevenLabs premade voice_id (성격에 맞춘 기본값). env MAP이 있으면 무시됨.
# 출처: ElevenLabs 기본 음성 (GET /v1/voices). 커스텀은 ELEVENLABS_VOICE_ID_MAP으로 덮어쓰기.
ELEVENLABS_DEFAULT_VOICE_MAP = {
    "en-US-ChristopherNeural": "TxGEqnHWrfWFTfGW9XjX",   # Josh — 다용도 남성, 밝고 명확
    "en-US-BrianNeural": "pNInz6obpgDQGcFmaJgB",         # Adam — 차분한 남성, 전문/내레이션
    "en-GB-RyanNeural": "pNInz6obpgDQGcFmaJgB",         # Adam — 낮고 차분 (gruff/우울 톤)
    "en-US-GuyNeural": "TxGEqnHWrfWFTfGW9XjX",           # Josh — 에너제틱/직설적
    "en-US-JennyNeural": "21m00Tcm4TlvDq8ikWAM",         # Rachel — 여성, 따뜻하고 공식적
    "en-US-AnaNeural": "EXAVITQu4vr4xnSDxMaL",           # Bella — 여성, 부드럽고 표현력
    "en-US-RogerNeural": "pNInz6obpgDQGcFmaJgB",         # Adam — 깊고 느린 남성 (학술/냉소)
}
client = None
_anthropic_client = None

def get_openai_client():
    global client
    if client is not None:
        return client
    if not API_KEY:
        raise RuntimeError("OPENAI_API_KEY environment variable is not set.")
    client = OpenAI(api_key=API_KEY)
    return client

def get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is not None:
        return _anthropic_client
    if _anthropic_module is None:
        raise RuntimeError("anthropic package is not installed. Run: pip install anthropic")
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY environment variable is not set.")
    _anthropic_client = _anthropic_module.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic_client

# ==========================================
# 2. 핵심 함수들
# ==========================================

def _map_openai_voice(voice: str):
    if not voice:
        return "alloy"
    v = voice.lower()
    if "ana" in v or "jenny" in v:
        return "nova"
    if "roger" in v or "brian" in v or "ryan" in v or "guy" in v or "christopher" in v:
        return "onyx"
    return "alloy"

def _rate_to_speed(rate: str):
    if not rate:
        return 1.0
    m = re.match(r"^([+-]?\d+)\%$", rate.strip())
    if not m:
        return 1.0
    pct = float(m.group(1)) / 100.0
    speed = 1.0 + pct
    return max(0.5, min(2.0, speed))

def _map_elevenlabs_voice(voice: str) -> str:
    """에이전트 voice 이름 또는 저장된 elevenlabs_voice_id → ElevenLabs voice_id."""
    v = (voice or "").strip()
    if len(v) >= 18 and v.isalnum():
        return v
    if ELEVENLABS_VOICE_ID_MAP:
        try:
            m = json.loads(ELEVENLABS_VOICE_ID_MAP)
            if voice and m.get(voice):
                return m[voice]
            v = (voice or "").lower()
            for k, vid in m.items():
                if k.lower() in v or v in k.lower():
                    return vid
        except Exception:
            pass
    if voice and ELEVENLABS_DEFAULT_VOICE_MAP.get(voice):
        return ELEVENLABS_DEFAULT_VOICE_MAP[voice]
    v = (voice or "").lower()
    for k, vid in ELEVENLABS_DEFAULT_VOICE_MAP.items():
        if k.lower() in v or v in k.lower():
            return vid
    return ELEVENLABS_VOICE_ID or ""

def _rate_to_speed_elevenlabs(rate: str) -> float:
    """rate (+-N%) → ElevenLabs speed (0.7–1.2)."""
    s = _rate_to_speed(rate)
    return max(0.7, min(1.2, s))


# ElevenLabs v3 Audio Tags — 자유형 emotion 텍스트를 매핑
EMOTION_TO_AUDIO_TAG = {
    "whisper": "[whispers]",
    "laugh": "[laughs]",
    "sigh": "[sighs]",
    "sarcas": "[sarcastic]",
    "excit": "[excited]",
    "cry": "[crying]",
    "curio": "[curious]",
    "nervou": "[nervous]",
    "frustr": "[frustrated]",
    "calm": "[calm]",
    "hesita": "[hesitates]",
    "stammer": "[stammers]",
}

def _emotion_to_audio_tag(emotion: str) -> str:
    """자유형 emotion 텍스트에서 ElevenLabs v3 audio tag를 추출.
    매칭되는 태그가 없으면 빈 문자열 반환."""
    if not emotion:
        return ""
    lower = emotion.lower()
    for keyword, tag in EMOTION_TO_AUDIO_TAG.items():
        if keyword in lower:
            return tag
    return ""


def _clean_llm_json(content: str) -> str:
    """LLM 응답에서 ```json 마크다운 래퍼를 제거하고 순수 JSON 문자열을 반환.
    파싱 실패 시 일반적인 LLM JSON 오류를 자동 수정 시도."""
    content = re.sub(r"```json", "", content)
    content = re.sub(r"```", "", content)
    content = content.strip()

    # 빠른 경로: 이미 유효한 JSON이면 그대로 반환
    try:
        json.loads(content)
        return content
    except (json.JSONDecodeError, ValueError):
        pass

    # 수리 시도
    repaired = content

    # 1) JSON 앞뒤의 비-JSON 텍스트 제거 (예: "Here is the JSON:\n{...}")
    first_brace = None
    for i, ch in enumerate(repaired):
        if ch in ('{', '['):
            first_brace = i
            break
    if first_brace and first_brace > 0:
        repaired = repaired[first_brace:]

    # 마지막 닫는 괄호 이후 텍스트 제거
    last_brace = None
    for i in range(len(repaired) - 1, -1, -1):
        if repaired[i] in ('}', ']'):
            last_brace = i
            break
    if last_brace is not None and last_brace < len(repaired) - 1:
        repaired = repaired[:last_brace + 1]

    # 2) trailing comma 제거: ,} 또는 ,]
    repaired = re.sub(r',\s*([}\]])', r'\1', repaired)

    # 3) 제어 문자 제거 (탭/개행 제외)
    repaired = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', repaired)

    try:
        json.loads(repaired)
        return repaired
    except (json.JSONDecodeError, ValueError):
        pass

    # 4) 잘린 JSON — 닫는 괄호 보충
    open_braces = repaired.count('{') - repaired.count('}')
    open_brackets = repaired.count('[') - repaired.count(']')
    if open_braces > 0 or open_brackets > 0:
        # 마지막 완전한 값 뒤에서 자르기 (불완전한 문자열 제거)
        # 마지막 쉼표나 콜론 뒤의 불완전한 값 제거
        cut = re.sub(r'[,:][\s]*"[^"]*$', '', repaired)
        cut = re.sub(r',\s*$', '', cut)
        cut += '}' * max(0, cut.count('{') - cut.count('}'))
        cut += ']' * max(0, cut.count('[') - cut.count(']'))
        try:
            json.loads(cut)
            return cut
        except (json.JSONDecodeError, ValueError):
            pass

    # 모든 수리 실패 — 원본 반환 (호출자에서 에러 처리)
    return content


def _tts_elevenlabs_bytes(text: str, voice: str, rate: str, max_attempts=4) -> bytes:
    """ElevenLabs TTS -> mp3 bytes를 메모리로 반환 (파일 저장 없음)."""
    if not ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY is not set. Set it to use TTS_PROVIDER=elevenlabs.")
    voice_id = _map_elevenlabs_voice(voice)
    if not voice_id:
        raise RuntimeError(
            "ELEVENLABS_VOICE_ID or ELEVENLABS_VOICE_ID_MAP is not set. "
            "Set ELEVENLABS_VOICE_ID (or map in ELEVENLABS_VOICE_ID_MAP) to use ElevenLabs TTS."
        )
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    speed = _rate_to_speed_elevenlabs(rate)
    payload = {
        "text": text,
        "model_id": ELEVENLABS_MODEL_ID,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": speed},
    }
    body = json.dumps(payload).encode("utf-8")
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            req = urllib.request.Request(
                url,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Accept": "audio/mpeg",
                },
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            return data
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            print(f"[TTS] attempt {attempt}/{max_attempts} HTTP {e.code}: {err_body} | model={ELEVENLABS_MODEL_ID} voice={voice_id} text_len={len(text)}")
            last_err = e
            time.sleep(min(2 ** attempt, 8))
        except Exception as e:
            print(f"[TTS] attempt {attempt}/{max_attempts} error: {e}")
            last_err = e
            time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(
        f"ElevenLabs TTS failed after retries (voice_id={voice_id}). Last error: {last_err}"
    ) from last_err

def _tts_elevenlabs(text: str, voice: str, rate: str, filename: str, max_attempts=4):
    """하위 호환 wrapper: bytes를 파일에 저장."""
    data = _tts_elevenlabs_bytes(text, voice, rate, max_attempts)
    with open(filename, "wb") as f:
        f.write(data)

def _sfx_elevenlabs(text: str, filename: str, max_attempts=4):
    """ElevenLabs Sound Effects API로 효과음을 생성한다.

    SDK 예시: elevenlabs.text_to_sound_effects.convert(text="...")
    """
    if not ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY is not set. Set it to use ElevenLabs SFX generation.")

    clean = (text or "").strip()
    if not clean:
        clean = "Cinematic Braam, Horror"

    # SDK가 있으면 우선 사용: elevenlabs.text_to_sound_effects.convert(text="...")
    if ElevenLabs is not None:
        last_err = None
        for attempt in range(1, max_attempts + 1):
            try:
                elevenlabs = ElevenLabs(api_key=ELEVENLABS_API_KEY)
                audio = elevenlabs.text_to_sound_effects.convert(text=clean)
                with open(filename, "wb") as f:
                    for chunk in audio:
                        if chunk:
                            f.write(chunk)
                if os.path.exists(filename) and os.path.getsize(filename) > 0:
                    return
                raise RuntimeError("Empty response from ElevenLabs SDK SFX")
            except Exception as e:
                last_err = e
                time.sleep(min(2 ** attempt, 8))
        raise RuntimeError("ElevenLabs SDK SFX generation failed after retries.") from last_err

    # SDK 미설치 시 HTTP fallback
    payload = {"text": clean}
    body = json.dumps(payload).encode("utf-8")
    endpoints = [
        "https://api.elevenlabs.io/v1/sound-generation",
        "https://api.elevenlabs.io/v1/text-to-sound-effects",
    ]

    last_err = None
    for attempt in range(1, max_attempts + 1):
        for url in endpoints:
            try:
                req = urllib.request.Request(
                    url,
                    data=body,
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "xi-api-key": ELEVENLABS_API_KEY,
                        "Accept": "audio/mpeg",
                    },
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = resp.read()
                if not data:
                    raise RuntimeError("Empty response from ElevenLabs SFX API")
                with open(filename, "wb") as f:
                    f.write(data)
                return
            except Exception as e:
                last_err = e
        time.sleep(min(2 ** attempt, 8))

    raise RuntimeError("ElevenLabs SFX generation failed after retries.") from last_err

def _tts_with_retry_bytes(text, voice, rate, max_attempts=4) -> bytes:
    """OpenAI TTS -> mp3 bytes를 메모리로 반환 (파일 저장 없음)."""
    client = get_openai_client()
    mapped_voice = _map_openai_voice(voice)
    speed = _rate_to_speed(rate)
    last_err = None

    for attempt in range(1, max_attempts + 1):
        try:
            response = client.audio.speech.create(
                model="gpt-4o-mini-tts",
                voice=mapped_voice,
                input=text,
                speed=speed,
            )
            return response.content
        except Exception as e:
            last_err = e
            wait = min(2 ** attempt, 8)
            time.sleep(wait)

    # fallback: slow down + safer voice, then try again
    for attempt in range(1, 3):
        try:
            response = client.audio.speech.create(
                model="gpt-4o-mini-tts",
                voice="alloy",
                input=text,
                speed=0.9,
            )
            return response.content
        except Exception as e:
            last_err = e
            time.sleep(2)

    raise RuntimeError(
        "TTS failed after retries. Please simplify the sentence and try again."
    ) from last_err

def _tts_with_retry(text, voice, rate, filename, max_attempts=4):
    """하위 호환 wrapper: bytes를 파일에 저장."""
    data = _tts_with_retry_bytes(text, voice, rate, max_attempts)
    with open(filename, "wb") as f:
        f.write(data)


async def generate_audio_line(text, voice, rate, pitch, filename):
    """TTS_PROVIDER에 따라 OpenAI TTS 또는 ElevenLabs TTS로 텍스트를 오디오로 변환 (자동 재시도 포함)."""
    _ = pitch  # pitch not supported by OpenAI TTS; ElevenLabs는 voice_settings로 제어 가능
    if TTS_PROVIDER == "elevenlabs":
        return _tts_elevenlabs(text, voice, rate, filename)
    return _tts_with_retry(text, voice, rate, filename)


async def generate_audio_line_bytes(text, voice, rate, pitch) -> bytes:
    """TTS 오디오를 bytes로 반환 (파일 저장 없음). produce_agent용."""
    _ = pitch
    if TTS_PROVIDER == "elevenlabs":
        return _tts_elevenlabs_bytes(text, voice, rate)
    return _tts_with_retry_bytes(text, voice, rate)


async def generate_sfx_audio(description, filename, max_attempts=3):
    """효과음을 생성. 기본은 TTS_PROVIDER를 따르며 description은 '[laughter]' 같은 형태."""
    # 대괄호 제거하여 순수 설명만 추출
    clean = re.sub(r"[\[\]]", "", description).strip()
    if not clean:
        clean = "short impact sound"

    if TTS_PROVIDER == "elevenlabs":
        return _sfx_elevenlabs(clean, filename, max_attempts=max_attempts)

    # TTS에게 효과음을 연기하도록 지시
    tts_input = f"*{clean}*"

    client = get_openai_client()
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = client.audio.speech.create(
                model="gpt-4o-mini-tts",
                voice="alloy",
                input=tts_input,
                instructions=f"Produce a short vocal sound effect: {clean}. Do NOT speak words. Only produce the sound effect itself using your voice. Keep it under 2 seconds.",
                speed=1.0,
            )
            response.write_to_file(filename)
            return
        except Exception as e:
            last_err = e
            time.sleep(min(2 ** attempt, 4))
    raise RuntimeError(f"SFX TTS failed after {max_attempts} attempts: {last_err}")


def _normalize_sfx_volume(filename, target_lufs=-23.0):
    """SFX 오디오의 볼륨을 EBU R128 loudnorm으로 정규화하여 갑작스러운 큰 소리를 방지."""
    normalized = filename + ".norm.mp3"
    cmd = [
        _FFMPEG_CMD, "-y", "-i", filename,
        "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
        "-c:a", "libmp3lame", "-b:a", "192k",
        normalized,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode == 0 and os.path.exists(normalized) and os.path.getsize(normalized) > 0:
        os.replace(normalized, filename)
    else:
        if os.path.exists(normalized):
            os.remove(normalized)
        print(f"[SFX] loudnorm failed, using original: {result.stderr[-200:] if result.stderr else ''}")


def get_audio_duration(filename):
    """FFmpeg(ffprobe)를 이용해 오디오 파일의 정확한 길이(초) 측정"""
    cmd = [
        _FFPROBE_CMD, "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filename
    ]
    try:
        # 윈도우에서는 shell=True가 필요할 수 있음
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True)
        return float(result.stdout.strip())
    except Exception as e:
        print(f"❌ Error getting duration for {filename}: {e}")
        return 0.0

def get_audio_duration_from_bytes(audio_bytes: bytes) -> float:
    """FFmpeg(ffprobe/ffmpeg) + stdin pipe로 오디오 바이트의 정확한 길이(초) 측정."""
    # 1차: ffprobe로 시도
    cmd = [
        _FFPROBE_CMD, "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        "pipe:0",
    ]
    try:
        result = subprocess.run(
            cmd, input=audio_bytes, capture_output=True, check=True
        )
        dur = result.stdout.decode().strip()
        if dur and dur != "N/A":
            return float(dur)
    except Exception:
        pass

    # 2차: ffmpeg로 null 출력하며 디코딩 — 스트리밍 MP3에서도 정확
    cmd2 = [
        _FFMPEG_CMD, "-v", "error", "-i", "pipe:0",
        "-f", "null", "-",
    ]
    try:
        result2 = subprocess.run(
            cmd2, input=audio_bytes, capture_output=True
        )
        # stderr에서 "time=00:00:05.23" 패턴 추출
        stderr_text = result2.stderr.decode(errors="replace")
        import re as _re
        match = _re.search(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)", stderr_text)
        if match:
            h, m, s = float(match.group(1)), float(match.group(2)), float(match.group(3))
            return h * 3600 + m * 60 + s
    except Exception as e:
        print(f"Error getting duration from bytes: {e}")

    return 0.0

def _slugify(value):
    value = (value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    value = value.strip("_")
    return value or "item"

def _ensure_sentence_end(text: str):
    t = (text or "").strip()
    if not t:
        return t
    if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
        t = t[1:-1].strip()
    if t.endswith(("...", "…")):
        return t
    if t.endswith((".", "!", "?")):
        return t
    return t + "."

def _split_subtitle_chunks(text: str, max_words: int = 7) -> list[str]:
    """Split a sentence into readable subtitle chunks (~max_words each).
    Breaks on punctuation boundaries or word count limit."""
    import re
    words = text.split()
    if len(words) <= max_words:
        return [text]
    chunks: list[str] = []
    buf: list[str] = []
    for word in words:
        buf.append(word)
        ends_with_punct = bool(re.search(r'[,;.!?]$', word))
        if ends_with_punct or len(buf) >= max_words:
            chunks.append(" ".join(buf))
            buf = []
    if buf:
        chunks.append(" ".join(buf))
    return chunks if chunks else [text]

def _agent_description(host):
    """에이전트의 구조화된 필드로 설명 문자열을 생성. personality가 없으면 system_prompt 폴백."""
    personality = (host.get("personality") or "").strip()
    speaking_style = (host.get("speaking_style") or "").strip()
    concept = (host.get("concept") or "").strip()
    system_prompt = (host.get("system_prompt") or "").strip()

    if personality:
        parts = [f"  - Personality: {personality}",
                 f"  - Speaking style: {speaking_style}" if speaking_style else None]
        return "\n".join(p for p in parts if p)
    # 기존 에이전트 폴백
    if system_prompt:
        return f"  - Description: {system_prompt}"
    if concept:
        return f"  - Description: {concept}"
    return "  - (no description available)"

def allocate_agent_id(name):
    base = _slugify(name)
    suffix = uuid.uuid4().hex[:6]
    return f"{base}_{suffix}"

def generate_clip_assist(title, setting=None, situation=None, core_emotion=None, relationship_state=None, tone=None, host1=None, host2=None):
    """Title + 부분 입력으로 Title/Setting/Situation/Core Emotion/Relationship State/Tone을 LLM이 보강/생성."""
    title = (title or "").strip()
    setting = (setting or "").strip()
    situation = (situation or "").strip()
    core_emotion = (core_emotion or "").strip()
    relationship_state = (relationship_state or "").strip()
    tone = (tone or "").strip()

    agent_block = ""
    if host1 and host2:
        agent_block = f"""
    Character 1: {host1.get('name', 'Agent 1')}
{_agent_description(host1)}

    Character 2: {host2.get('name', 'Agent 2')}
{_agent_description(host2)}

    Use these characters' personalities and concepts to craft fields that feel natural and specific to WHO they are.
"""

    prompt = f"""
    Given the following partial inputs for a short audio drama clip, fill in or enhance the missing/weak fields.
    The clip will be a ~60 second dramatic conversation between two characters.

    Title: {title if title else "(empty — generate one)"}
    Setting: {setting if setting else "(empty — generate one)"}
    Situation: {situation if situation else "(empty — generate one)"}
    Core Emotion: {core_emotion if core_emotion else "(empty — generate one)"}
    Relationship State: {relationship_state if relationship_state else "(empty — generate one)"}
    Tone: {tone if tone else "(empty — generate one)"}
{agent_block}
    Rules:
    - If a field is empty, invent something vivid, specific, and grounded in reality{' that fits the characters' if agent_block else ''}.
    - If a field already has content, enhance it — make it more specific and concrete. You MUST preserve the user's core meaning and intent. Build on their words, don't replace them.
    - Title: A short, punchy title that hints at a specific moment or emotional beat. Max 60 characters.
    - Setting: A REAL, SPECIFIC place and time. Not a mood — a location. (e.g., "Hospital parking lot, 2 AM, engine still running" not "A tense space between two worlds"). Max 300 characters.
    - Situation: WHAT is physically happening RIGHT NOW. A concrete action in progress. (e.g., "He's packing a suitcase while she stands in the doorway" not "Two souls confront unspoken truths"). Max 300 characters.
    - Core Emotion: The dominant feeling in this scene. Short, specific, evocative. (e.g., "quiet comfort after a long silence", "nervous attraction neither names"). Max 150 characters.
    - Relationship State: Where these two people stand emotionally right now. (e.g., "newly familiar — past the strangers phase but not yet friends", "unspoken closeness they both deny"). Max 150 characters.
    - Tone: The overall mood/atmosphere. One or two words. (e.g., "warm", "bittersweet", "playful tension"). Max 100 characters.

    Output strictly valid JSON:
    {{
      "title": "...",
      "setting": "...",
      "situation": "...",
      "core_emotion": "...",
      "relationship_state": "...",
      "tone": "..."
    }}
    """

    completion = get_openai_client().chat.completions.create(
        model="gpt-5-mini",
        messages=[
            {"role": "system", "content": (
                "You are a drama scenario designer for emotionally rich audio dramas. "
                "IMPORTANT: Write ALL output in English, regardless of the input language. "
                "Output strictly valid JSON with title, setting, situation, core_emotion, relationship_state, and tone fields. "
                "Title: max 60 chars. Setting/Situation: max 300 chars. Core Emotion/Relationship State: max 150 chars. Tone: max 100 chars.\n\n"
                "CRITICAL RULES:\n"
                "- Core Emotion must be SPECIFIC and FELT — not abstract concepts.\n"
                "- Bad: 'tension', 'conflict between duty and desire'\n"
                "- Good: 'the ache of wanting to say something but swallowing it', 'quiet pride watching someone succeed'\n"
                "- Relationship State must be concrete and interpersonal — not plot summary.\n"
                "- Setting must be a real, specific place — not a vague mood.\n"
                "- Situation must describe something physically happening RIGHT NOW.\n"
                "- Tone should be atmospheric — one or two evocative words."
            )},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
    )

    content = _clean_llm_json(completion.choices[0].message.content)
    result = json.loads(content)

    # truncate
    title_val = (str(result.get("title") or "")).strip()
    if len(title_val) > 60:
        title_val = title_val[:60]
    result["title"] = title_val

    for field, limit in [("setting", 300), ("situation", 300), ("core_emotion", 150), ("relationship_state", 150), ("tone", 100)]:
        val = (str(result.get(field) or "")).strip()
        if len(val) > limit:
            val = val[:limit]
        result[field] = val

    print(f"[clip_assist] Generated assist for '{title or title_val}'")
    return result


def generate_clip_script(host1, host2, title, setting=None, situation=None,
                         core_emotion=None, relationship_state=None, tone=None,
                         series_context=None, arc_phase=None, episode_number=None,
                         total_episodes=None, relationship_context=None,
                         series_document=None, arc_document=None,
                         episode_type=None, language=None):
    """입력(setting/situation/core_emotion/relationship_state/tone)에서 바로 드라마 스크립트를 생성한다."""
    setting = (setting or "").strip()
    situation = (situation or "").strip()
    core_emotion = (core_emotion or "").strip()
    relationship_state = (relationship_state or "").strip()
    tone = (tone or "").strip()

    # 시리즈 문서 컨텍스트 (IMMUTABLE)
    series_bible_block = ""
    if series_document and isinstance(series_document, dict):
        genre = series_document.get("genre", {})
        worldview = series_document.get("worldview", {})
        conflicts = series_document.get("main_conflicts", {})
        series_bible_block = f"""
    === SERIES BIBLE (IMMUTABLE) ===
    Genre: {genre.get('main', '')} / {genre.get('sub', '')}
    Worldview: {worldview.get('time_period', '')} | {worldview.get('space', '')} | Tone: {worldview.get('tone', '')}
    Main Conflicts:
    - Surface: {conflicts.get('surface', '')}
    - Internal: {conflicts.get('internal', '')}
    - Relationship: {conflicts.get('relationship', '')}
"""

    arc_block = ""
    if arc_document and isinstance(arc_document, dict):
        arc_block = f"""
    === ARC DOCUMENT (IMMUTABLE) ===
    Season Goal: {arc_document.get('season_goal', '')}
    Current Arc Phase: {arc_phase or 'setup'}
"""

    # 시리즈 연속 컨텍스트
    series_block = ""
    if series_context and episode_number:
        story_so_far = ""
        for ep in series_context:
            story_so_far += f"\n    Episode {ep.get('episode', '?')}: {ep.get('summary', '')}"

        last_ep = series_context[-1] if series_context else {}
        last_emotions = last_ep.get("emotional_state", {})
        last_threads = last_ep.get("unresolved_threads", [])

        series_block = f"""
    === SERIES CONTINUATION ===
    This is Episode {episode_number} in an ongoing drama series.

    Character relationship: {relationship_context or '(not specified)'}

    Story so far:{story_so_far}

    Previous episode emotional states:
    - {host1['name']}: {last_emotions.get('agent1', 'unknown')}
    - {host2['name']}: {last_emotions.get('agent2', 'unknown')}

    Unresolved threads from previous episode: {json.dumps(last_threads)}

    - Continue from where the story left off. Reference specific events from previous episodes naturally.
    - Show character growth/change from previous episodes.
    - Do NOT repeat scenes or dialogue from previous episodes.
    - Do NOT recap or summarize previous episodes in dialogue.
"""

    # 에피소드 타입별 톤/구조 가이드
    episode_tone_guide = ""
    if episode_type:
        tone_guides = {
            "slice_of_life": (
                "=== EPISODE TONE: SLICE OF LIFE ===\n"
                "    - Warm, everyday atmosphere. No major conflict escalation.\n"
                "    - Focus on quiet character moments, daily routines, small discoveries.\n"
                "    - Gentle pace. Comfortable silences are okay.\n"
                "    - End on a warm or bittersweet note, not a dramatic cliffhanger.\n"
                "    - Think: two people sharing a meal, a quiet walk, a casual conversation that reveals something small but meaningful.\n"
            ),
            "comedy_incident": (
                "=== EPISODE TONE: COMEDY INCIDENT ===\n"
                "    - Light, humorous tone. A funny mishap or misunderstanding drives the scene.\n"
                "    - Characters react with surprise, embarrassment, or playful banter.\n"
                "    - Physical comedy through SFX (things falling, awkward sounds, unexpected noises).\n"
                "    - End with a laugh or a shared moment of absurdity.\n"
                "    - Do NOT escalate into real conflict. Keep it fun and lighthearted.\n"
            ),
            "relationship_progress": (
                "=== EPISODE TONE: RELATIONSHIP PROGRESS ===\n"
                "    - Emotionally significant. A shift in how the characters see each other.\n"
                "    - Vulnerability, honesty, or a small act of trust.\n"
                "    - Moderate tension — not explosive, but meaningful.\n"
                "    - End with a clear emotional change: closer, more open, or newly complicated.\n"
            ),
            "mystery_hint": (
                "=== EPISODE TONE: MYSTERY HINT ===\n"
                "    - Suspenseful, curious atmosphere. Something doesn't add up.\n"
                "    - One character notices or discovers something unusual.\n"
                "    - Build intrigue through small details, unanswered questions, evasive responses.\n"
                "    - End with an unresolved question or a lingering sense that something is off.\n"
                "    - Do NOT reveal the full answer. Leave the audience wanting more.\n"
            ),
            "tension_episode": (
                "=== EPISODE TONE: TENSION EPISODE ===\n"
                "    - High emotional stakes. A confrontation or difficult conversation.\n"
                "    - Escalate → breaking point → grounded ending.\n"
                "    - Sharp, charged dialogue. Short lines. Loaded silences.\n"
                "    - End with aftermath — exhaustion, a hard truth, or an uneasy truce.\n"
            ),
            "soft_reset": (
                "=== EPISODE TONE: SOFT RESET (STANDALONE) ===\n"
                "    - Self-contained episode. A new viewer should enjoy it without prior context.\n"
                "    - Focus purely on character charm and warmth.\n"
                "    - No main plot progression. No references to ongoing storylines.\n"
                "    - Light, inviting, showcases why these characters are likable.\n"
            ),
        }
        episode_tone_guide = tone_guides.get(episode_type, f"    Episode type: {episode_type}\n")

    prompt = f"""
    Write a ~60 second dramatic audio scene.

    Title: {title}
    Setting: {setting if setting else "(not provided — infer from context)"}
    Situation: {situation if situation else "(not provided — infer from context)"}
    Core Emotion: {core_emotion if core_emotion else "(not provided — infer from context)"}
    Relationship State: {relationship_state if relationship_state else "(not provided — infer from context)"}
    Tone: {tone if tone else "(not provided — infer from context)"}

    === CHARACTER 1 (speaker ID: "{host1['id']}") — Name: {host1['name']} ===
{_agent_description(host1)}

    === CHARACTER 2 (speaker ID: "{host2['id']}") — Name: {host2['name']} ===
{_agent_description(host2)}
{series_bible_block}{arc_block}{series_block}
    {episode_tone_guide}The scene's emotional texture comes from the Core Emotion and Relationship State above.
    Build the scene around what the characters FEEL and HOW they relate.
    {"Escalate → breaking point → grounded ending." if not episode_type or episode_type == "tension_episode" else "Follow the episode tone guide above for pacing and structure."}
    Show emotion through physical behavior only. Do not explain motives or themes.
    Use (pause), (hesitates), (beat), (silence) inside dialogue text for realistic breathing and rhythm.

    CRITICAL: "speaker" field must use the EXACT speaker ID shown above, NOT the character name.
    - {host1['name']} → "speaker": "{host1['id']}"
    - {host2['name']} → "speaker": "{host2['id']}"
    Match dialogue content to each character's PERSONALITY, not their name.

    Return ONLY valid JSON:
    {{ "lines": [...] }}
    - Dialogue: {{ "speaker": "{host1['id']}" or "{host2['id']}", "text": "...", "emotion": "specific voice direction" }}
    - SFX: {{ "speaker": "sfx", "text": "[2-5 word sound]" }}
    - Narration: {{ "speaker": "narration", "text": "Scene description read aloud by narrator. No character voice. Present tense, plain language." }}
    - "emotion" must be specific voice direction, not generic labels (not "angry"/"sad"/"happy").
    - Narration has no "emotion" field.
    """

    system_msg = (
        f"You write short live-action drama audio scenes. Return JSON only. {_lang_directive(language)}\n"
        "Match dialogue to each character's PERSONALITY, not their name.\n\n"
        "STYLE: Modern TV drama. Natural, grounded, not theatrical.\n\n"
        "RULES:\n"
        "- No abstract nouns, metaphors, philosophy, or speeches in dialogue.\n"
        "- Show feelings through behavior only. Conflict must be concrete and present.\n"
        "- If a line sounds literary, rewrite simpler.\n"
        "- Max 12 words per line. Most under 8. Short, direct, slightly awkward.\n"
        "- () in dialogue = emotion/breath ONLY: (pause), (beat), (exhales), (scoffs).\n"
        "- NEVER physical actions in (): no (slams door), (walks away), (grabs arm).\n"
        "- Catchphrase/verbal tic: at most ONCE per scene.\n"
        "- Names used naturally 2–3 times total.\n\n"
        "EMOTION FIELD: Voice direction for TTS (tone, breath, pace). No physical actions.\n"
        '- BAD: "angry" / "sad" / "(lunges) — Cover that!"\n'
        '- GOOD: "low voice, jaw tight, controlled rage" / "voice cracking, trying not to cry"\n\n'
        "SFX: 2–5 words. Name the sound only. No emotions or stories.\n"
        '- BAD: [tense atmosphere] [keys hit the table hard]\n'
        '- GOOD: [keys slam] [door shuts] [glass breaks]\n\n'
        "NARRATION: Last resort — only for actions sound cannot convey. 1–2 sentences, present tense.\n\n"
        "STRUCTURE:\n"
        "- 17–24 lines total. 1–3 SFX. 0–2 narration.\n"
        + (
            "- Match pacing to episode tone guide. If none: mid-tension → escalate → grounded ending.\n"
            if episode_type and episode_type != "tension_episode" else
            "- Start mid-tension. Escalate via SFX. Breaking point. End grounded.\n"
        ) +
        "- End 1–2 lines after climax. No new elements at the end.\n\n"
        "EXAMPLE:\n"
        '  {"speaker": "narration", "text": "She\'s at the nurses\' station, pen in hand."}\n'
        '  {"speaker": "A", "text": "Put the pen down.", "emotion": "low, controlled, not a request"}\n'
        '  {"speaker": "B", "text": "You\'re not my doctor.", "emotion": "flat, not looking up"}\n'
        '  {"speaker": "sfx", "text": "[pen clicks]"}\n'
        '  {"speaker": "A", "text": "Maya. (beat) It\'s one more night.", "emotion": "tight jaw, even voice"}\n'
        '  {"speaker": "B", "text": "Don\'t.", "emotion": "one word, hard stop"}\n'
        '  {"speaker": "B", "text": "(silence) ...fine. One night.", "emotion": "exhausted, giving in"}\n'
    )

    print(f"[script] system_msg preview: {system_msg[:100]}...")
    print(f"[script] prompt preview: {prompt[:300]}...")

    _script_schema = {
        "type": "object",
        "properties": {
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "speaker": {"type": "string"},
                        "text": {"type": "string"},
                        "emotion": {"type": "string"}
                    },
                    "required": ["speaker", "text", "emotion"],
                    "additionalProperties": False
                }
            }
        },
        "required": ["lines"],
        "additionalProperties": False
    }
    response = get_anthropic_client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=system_msg,
        messages=[
            {"role": "user", "content": prompt},
        ],
        output_config={"format": {"type": "json_schema", "schema": _script_schema}},
    )

    usage = response.usage
    print(f"[script] tokens: input={usage.input_tokens}, output={usage.output_tokens}")

    raw = response.content[0].text if response.content else ""
    print(f"[script] Raw LLM response length: {len(raw)} chars")
    if not raw.strip():
        print(f"[script] ERROR: Empty response from LLM. stop_reason={response.stop_reason}")
        raise ValueError("Script generation failed: LLM returned empty response")
    content = _clean_llm_json(raw)
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as e:
        print(f"[script] ERROR: JSON parse failed. First 500 chars: {content[:500]}")
        raise ValueError(f"Script generation failed: {e}")
    lines = payload.get("lines")
    if not isinstance(lines, list):
        raise ValueError("Clip script JSON must be an object with a 'lines' list.")
    lines = _sanitize_script_lines(lines, host1, host2)
    print(f"[script] Generated script for '{title}': {len(lines)} lines")
    return lines


def generate_episode_summary(script_lines, host1, host2, episode_number, arc_phase=None,
                             existing_rolling_summary=None):
    """완성된 스크립트 라인에서 에피소드 요약을 생성하고, 롤링 요약도 동시에 재압축한다.
    Returns: (episode_summary dict, rolling_summary str)
    """
    dialogue_text = "\n".join(
        f"{line.get('speaker', '?')}: {line.get('text', '')}"
        for line in script_lines
        if line.get("text")
    )

    rolling_block = ""
    rolling_instruction = ""
    if existing_rolling_summary is not None:
        rolling_block = f"""
EXISTING ROLLING SUMMARY (compress with new episode):
{existing_rolling_summary or '(None — first episode)'}
"""
        rolling_instruction = '\n  "rolling_summary": "Compressed story history under 500 chars. Recent events more detailed, older events condensed.",'

    prompt = f"""
Summarize this drama episode for series continuity, and compress the running story history.

Episode {episode_number}
Character 1: {host1.get('name', 'Agent 1')}
Character 2: {host2.get('name', 'Agent 2')}
{rolling_block}
Script:
{dialogue_text[:3000]}

Output strictly valid JSON:
{{
  "summary": "2-3 sentence plot summary of what happened in this episode",
  "key_events": ["event 1", "event 2", "event 3"],
  "emotional_state": {{
    "agent1": "{host1.get('name', 'Agent 1')}'s emotional state at the end",
    "agent2": "{host2.get('name', 'Agent 2')}'s emotional state at the end"
  }},
  "relationship_evolution": "How the relationship changed this episode",
  "unresolved_threads": ["thread that could continue in next episode"]{rolling_instruction}
}}
"""

    completion = get_openai_client().chat.completions.create(
        model="gpt-5-mini",
        messages=[
            {"role": "system", "content": "You are a story continuity assistant. Summarize drama episodes and compress running story history. Output strictly valid JSON."},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
    )

    content = _clean_llm_json(completion.choices[0].message.content)
    result = json.loads(content)

    # rolling_summary 분리
    rolling_summary = result.pop("rolling_summary", None)
    if rolling_summary and len(rolling_summary) > 500:
        rolling_summary = rolling_summary[:500]

    episode_summary = result
    print(f"[episode_summary] Generated summary for episode {episode_number}:")
    print(json.dumps(episode_summary, indent=2, ensure_ascii=False))
    if rolling_summary is not None:
        print(f"[rolling_summary] Updated inline: {len(rolling_summary)} chars")

    return episode_summary, rolling_summary


def generate_next_options(episode_summary, host1, host2, story_context=None, setting=None,
                          episode_types=None, series_document=None, arc_document=None,
                          core_memory=None, rolling_summary=None, arc_phase=None):
    """현재 에피소드 요약을 바탕으로 다음 에피소드의 3가지 선택지를 생성한다.

    episode_types가 주어지면 각 선택지에 해당 에피소드 타입의 톤/분위기를 반영한다.
    series_document, arc_document, core_memory, rolling_summary, arc_phase가 주어지면
    시리즈 맥락을 반영한 고품질 선택지를 생성한다.
    """
    story_so_far = ""
    if story_context:
        for ep in story_context:
            story_so_far += f"\n    Episode {ep.get('episode', '?')}: {ep.get('summary', '')}"

    current_summary = episode_summary.get("summary", "")
    unresolved = json.dumps(episode_summary.get("unresolved_threads", []))
    relationship = episode_summary.get("relationship_evolution", "")
    emotional_state = episode_summary.get("emotional_state", {})

    # 에피소드 타입별 톤 설명
    _TYPE_TONE_LABELS = {
        "slice_of_life": "SLICE OF LIFE — warm, everyday, character-focused, no major conflict",
        "comedy_incident": "COMEDY INCIDENT — funny mishap, lighthearted, playful banter",
        "relationship_progress": "RELATIONSHIP PROGRESS — emotional shift, vulnerability, trust or betrayal",
        "mystery_hint": "MYSTERY HINT — suspense, unanswered questions, something feels off",
        "tension_episode": "TENSION EPISODE — confrontation, high stakes, charged atmosphere",
    }

    type_constraint = ""
    if episode_types and len(episode_types) >= 3:
        type_constraint = "\nCRITICAL: Each option MUST match its assigned episode type. The type determines the tone, pacing, and focus.\n"
        for i, et in enumerate(episode_types):
            tone = _TYPE_TONE_LABELS.get(et, et)
            type_constraint += f"- Option {i+1} episode_type: \"{et}\" — {tone}\n"
        type_constraint += "The setting, situation, core_emotion, relationship_state, and tone MUST reflect the assigned episode type.\n"

    # 시리즈 맥락 블록
    series_bible_block = ""
    if series_document and isinstance(series_document, dict):
        genre = series_document.get("genre", {})
        worldview = series_document.get("worldview", {})
        conflicts = series_document.get("main_conflicts", {})
        series_bible_block = f"""
=== SERIES BIBLE ===
Genre: {genre.get('main', '')} / {genre.get('sub', '')}
Worldview: {worldview.get('time_period', '')} | {worldview.get('space', '')} | Tone: {worldview.get('tone', '')}
Main Conflicts:
- Surface: {conflicts.get('surface', '')}
- Internal: {conflicts.get('internal', '')}
- Relationship: {conflicts.get('relationship', '')}
"""

    arc_block = ""
    if arc_document and isinstance(arc_document, dict):
        arc_block = f"""
=== ARC DOCUMENT ===
Season Goal: {arc_document.get('season_goal', '')}
Act 1 Transition: {arc_document.get('act1_transition_event', '')}
Mid Reversal: {arc_document.get('mid_reversal', '')}
Climax Conditions: {arc_document.get('climax_conditions', '')}
Current Arc Phase: {arc_phase or 'setup'}
"""

    memory_block = ""
    if core_memory and isinstance(core_memory, dict):
        key_events = core_memory.get("key_events", [])
        open_threads = core_memory.get("open_threads", [])
        foreshadowing = [f for f in core_memory.get("foreshadowing", []) if f.get("status") != "resolved"]

        memory_parts = []
        if key_events:
            memory_parts.append("Key Events: " + " | ".join(str(e) for e in key_events[-5:]))
        if open_threads:
            memory_parts.append("Open Threads:\n" + "\n".join(f"  - {t}" for t in open_threads))
        if foreshadowing:
            memory_parts.append("Planted Foreshadowing:\n" + "\n".join(
                f"  - \"{f.get('hint')}\" (target EP{f.get('target_ep_range')})" for f in foreshadowing
            ))
        if memory_parts:
            memory_block = "\n=== CORE MEMORY ===\n" + "\n".join(memory_parts) + "\n"

    rolling_block = ""
    if rolling_summary:
        rolling_block = f"\n=== STORY SO FAR (compressed) ===\n{rolling_summary}\n"

    prompt = f"""
Based on this drama series, generate 3 different possible directions for the NEXT episode.
Each option must feel like a genuinely distinct story path — different emotional register, different stakes, different focus.
{type_constraint}{series_bible_block}{arc_block}{rolling_block}{memory_block}
Characters:
- {host1.get('name', 'Agent 1')}: {host1.get('personality', '')[:200]}
- {host2.get('name', 'Agent 2')}: {host2.get('personality', '')[:200]}

Current setting: {setting or '(not specified)'}

Story so far (episode summaries):{story_so_far}

Latest episode summary: {current_summary}
Relationship evolution: {relationship}
Emotional states:
- {host1.get('name')}: {emotional_state.get('agent1', 'unknown')}
- {host2.get('name')}: {emotional_state.get('agent2', 'unknown')}
Unresolved threads: {unresolved}

For each option, provide:
- label: A short catchy one-line description (max 60 chars) that hints at the direction
- title: An episode title (max 60 chars)
- setting: WHERE and WHEN the next scene takes place (max 300 chars)
- situation: WHAT is happening (max 300 chars)
- core_emotion: The dominant feeling in this episode (max 150 chars)
- relationship_state: Where the characters stand emotionally (max 150 chars)
- tone: The mood/atmosphere (max 100 chars, e.g., "warm", "bittersweet", "playful")
- episode_type: The assigned episode type string

RULES:
- Each option must diverge clearly in emotional tone and direction.
- Options must be grounded in the series world and character personalities.
- If open threads or foreshadowing exist, at least one option should organically incorporate them.
- The arc phase ({arc_phase or 'setup'}) should inform the stakes and emotional weight of each option.
- AVOID REPETITION: Do NOT propose directions that repeat or closely resemble situations,
  settings, or emotional dynamics already explored in previous episodes listed above.
  Each option must introduce a genuinely NEW scenario, location, or character dynamic.
- TONE BALANCE: Prioritize fun, light, and satisfying storylines. At most 1 out of 3 options
  should involve heavy emotional drama or complex tension.

Output strictly valid JSON:
{{
  "options": [
    {{ "label": "...", "title": "...", "setting": "...", "situation": "...", "core_emotion": "...", "relationship_state": "...", "tone": "...", "episode_type": "..." }},
    {{ "label": "...", "title": "...", "setting": "...", "situation": "...", "core_emotion": "...", "relationship_state": "...", "tone": "...", "episode_type": "..." }},
    {{ "label": "...", "title": "...", "setting": "...", "situation": "...", "core_emotion": "...", "relationship_state": "...", "tone": "...", "episode_type": "..." }}
  ]
}}
"""

    system_msg = (
        "You are a drama story planner for an ongoing audio drama series. "
        "Generate 3 compelling, distinct story directions for the next episode. "
        "Each option should feel like a genuinely different path the story could take, "
        "grounded in the series world, character arcs, and accumulated story history. "
        "IMPORTANT: Write ALL output in English, regardless of the input language.\n\n"
        "TONE PRIORITY: Favor fun, entertaining, and satisfying storylines (comedy, adventure, "
        "heartwarming moments, exciting discoveries) over heavy emotional drama. "
        "About 80% of options should be light and enjoyable; complex emotional tension "
        "should appear in at most 1 out of 3 options. It's okay to be predictable — "
        "audiences enjoy satisfying payoffs."
    )

    _options_schema = {
        "type": "object",
        "properties": {
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "title": {"type": "string"},
                        "setting": {"type": "string"},
                        "situation": {"type": "string"},
                        "core_emotion": {"type": "string"},
                        "relationship_state": {"type": "string"},
                        "tone": {"type": "string"},
                        "episode_type": {"type": "string"}
                    },
                    "required": ["label", "title", "setting", "situation", "core_emotion", "relationship_state", "tone", "episode_type"],
                    "additionalProperties": False
                }
            }
        },
        "required": ["options"],
        "additionalProperties": False
    }
    response = get_anthropic_client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=[{"type": "text", "text": system_msg}],
        messages=[{"role": "user", "content": prompt}],
        output_config={"format": {"type": "json_schema", "schema": _options_schema}},
    )
    raw = response.content[0].text or ""
    usage = response.usage
    print(f"[next_options] tokens: input={usage.input_tokens}, output={usage.output_tokens}")

    content = _clean_llm_json(raw)
    result = json.loads(content)
    options = result.get("options", [])

    # truncate fields
    for opt in options:
        for field in ("label", "title"):
            val = (str(opt.get(field) or "")).strip()
            if len(val) > 60:
                val = val[:60]
            opt[field] = val
        for field, limit in [("setting", 300), ("situation", 300), ("core_emotion", 150), ("relationship_state", 150), ("tone", 100)]:
            val = (str(opt.get(field) or "")).strip()
            if len(val) > limit:
                val = val[:limit]
            opt[field] = val

    # 시스템이 결정한 episode_type을 강제 덮어쓰기 (LLM이 바꿀 수 없도록)
    if episode_types:
        for i, opt in enumerate(options):
            if i < len(episode_types):
                opt["episode_type"] = episode_types[i]

    print(f"[next_options] Generated {len(options)} options for next episode"
          + (f" (types: {episode_types})" if episode_types else ""))
    return options


# ==========================================
# 시리즈 문서 / 아크 문서 생성 (Phase 1)
# ==========================================

def generate_series_and_arc_document(host1, host2, idea, language=None):
    """에이전트 카드 2개 + 메인 아이디어로 시리즈 문서 + 아크 문서를 생성한다."""
    agent1_desc = _agent_description(host1)
    agent2_desc = _agent_description(host2)

    system_msg = (
        "You are a professional series bible writer for audio dramas.\n"
        "Given two character cards and a main idea, create a comprehensive series document and arc document.\n"
        f"{_lang_directive(language)} Return strictly valid JSON, no other text.\n"
    )

    prompt = f"""
Create a series bible and arc document for an audio drama.

=== CHARACTER 1: {host1.get('name', 'Agent 1')} ===
{agent1_desc}

=== CHARACTER 2: {host2.get('name', 'Agent 2')} ===
{agent2_desc}

=== MAIN IDEA ===
{idea}

Output this exact JSON structure:
{{
  "series_title": "A catchy, memorable title for the series (max 60 chars, do NOT include character names)",
  "series_document": {{
    "characters": [
      {{
        "agent_id": "{host1.get('id', '')}",
        "name": "{host1.get('name', 'Agent 1')}",
        "concept": "1-3 sentences, max 150 chars. Stay faithful to original, adapt lightly to worldview",
        "personality": "Comma-separated keywords, max 100 chars. e.g. 'cheerful, impulsive, secretly insecure'",
        "speech_examples": ["Max 120 chars each. Natural line in character voice", "Example line 2", "Example line 3"],
        "secret": "1-2 sentences, max 120 chars. A hidden truth or motivation"
      }},
      {{
        "agent_id": "{host2.get('id', '')}",
        "name": "{host2.get('name', 'Agent 2')}",
        "concept": "1-3 sentences, max 150 chars. Stay faithful to original, adapt lightly to worldview",
        "personality": "Comma-separated keywords, max 100 chars. e.g. 'cheerful, impulsive, secretly insecure'",
        "speech_examples": ["Max 120 chars each. Natural line in character voice", "Example line 2", "Example line 3"],
        "secret": "1-2 sentences, max 120 chars. A hidden truth or motivation"
      }}
    ],
    "genre": {{
      "main": "Max 30 chars. e.g. romance, thriller, comedy, drama, mystery",
      "sub": "Max 30 chars. Secondary genre that adds flavor"
    }},
    "worldview": {{
      "time_period": "Max 50 chars. When the story takes place",
      "space": "Max 100 chars. Primary locations and environment",
      "tone": "Max 60 chars. Overall atmosphere and mood"
    }},
    "main_conflicts": {{
      "surface": "1-2 sentences, max 150 chars. The visible, external conflict",
      "internal": "1-2 sentences, max 150 chars. The inner psychological struggle",
      "relationship": "1-2 sentences, max 150 chars. The core tension between the two characters"
    }},
    "character_fsm_schema": {{
      "agent1": ["Two emotional axes most relevant to this character's arc. e.g. trust_level, attachment_level, confidence_level, guilt_level, hope_level, etc."],
      "agent2": ["Two emotional axes most relevant to this character's arc. e.g. suspicion_level, openness_level, fear_level, affection_level, resolve_level, etc."]
    }},
    "episode_type_weights": {{
      "setup":      {{ "slice_of_life": 0.40, "comedy_incident": 0.40, "relationship_progress": 0.10, "mystery_hint": 0.05, "tension_episode": 0.05 }},
      "rising":     {{ "slice_of_life": 0.35, "comedy_incident": 0.35, "relationship_progress": 0.15, "mystery_hint": 0.10, "tension_episode": 0.05 }},
      "midpoint":   {{ "slice_of_life": 0.30, "comedy_incident": 0.30, "relationship_progress": 0.15, "mystery_hint": 0.10, "tension_episode": 0.15 }},
      "climax":     {{ "slice_of_life": 0.25, "comedy_incident": 0.25, "relationship_progress": 0.15, "mystery_hint": 0.10, "tension_episode": 0.25 }},
      "resolution": {{ "slice_of_life": 0.40, "comedy_incident": 0.35, "relationship_progress": 0.15, "mystery_hint": 0.05, "tension_episode": 0.05 }}
    }}
  }},
  "arc_document": {{
    "season_goal": "2-3 sentences, max 200 chars. The endpoint condition for the season",
    "act1_transition_event": "1-2 sentences, max 200 chars. The event that closes act 1 and raises stakes",
    "mid_reversal": "1-2 sentences, max 200 chars. A plot twist that changes the story direction",
    "climax_conditions": "1-2 sentences, max 200 chars. What triggers the peak tension"
  }}
}}

IMPORTANT:
- Keep each character's name exactly as given. Respect the original concept as much as possible, only adapting slightly to fit the worldview. Express personality as comma-separated keywords (not full sentences).
- Genre should match the idea's tone. Conflicts should have enough depth to sustain a long-running series.
- The arc document should provide concrete, specific events — not vague descriptions.
- Speech examples should sound natural, matching each character's speaking style.
- series_title must be creative and evocative — NOT just character names joined together.
- character_fsm_schema: Choose 2 emotional axes PER character that are MOST relevant to their arc and personality. Each axis should be a snake_case name ending in _level. Do NOT just copy the examples — choose axes that matter for THIS story.
- episode_type_weights: Adjust the ratios per arc phase to fit the genre. The 5 types are: slice_of_life, comedy_incident, relationship_progress, mystery_hint, tension_episode. Each phase's values must sum to 1.0. For example: a comedy should have higher comedy_incident and slice_of_life; a thriller should boost tension_episode and mystery_hint; a romance should emphasize relationship_progress. The example values above are defaults — tailor them to THIS series.
"""

    response = get_anthropic_client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=[{"type": "text", "text": system_msg}],
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text or ""
    usage = response.usage
    print(f"[series_doc] tokens: input={usage.input_tokens}, output={usage.output_tokens}")

    cleaned = _clean_llm_json(raw)
    result = json.loads(cleaned)

    if "series_document" not in result or "arc_document" not in result:
        raise ValueError("LLM response missing series_document or arc_document")

    print(f"[series_doc] Generated series + arc document for idea: {idea[:60]}...")
    return result


def _normalize_voice_age(raw):
    """Return one of 'young', 'middle_aged', 'old' for voice casting."""
    if not raw:
        return "middle_aged"
    s = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    if s in ("young", "middle_aged", "old"):
        return s
    return "middle_aged"


def generate_series_and_arc_document_from_idea(idea, language=None):
    """Main idea only: generate series + arc + two new character concepts. Returns series_document, arc_document, proposed_agents."""
    system_msg = (
        "You are a professional series bible writer for audio dramas.\n"
        "Given only a main idea, create a comprehensive series document and arc document with TWO original characters that fit the idea.\n"
        f"{_lang_directive(language)} Return strictly valid JSON, no other text.\n"
    )

    prompt = f"""
Create a series bible and arc document for an audio drama. Invent two distinct characters that fit the idea.

=== MAIN IDEA ===
{idea}

Output this exact JSON structure (character fields must match agent creation: concept/personality min 20 chars, speaking_style/appearance/intro_line min 10 chars):
{{
  "series_title": "A catchy, memorable title for the series (max 60 chars, do NOT include character names)",
  "series_document": {{
    "characters": [
      {{
        "agent_id": "",
        "name": "Character 1 name you invent",
        "concept": "2-4 sentences, min 20 chars. Setting, background, role.",
        "personality": "Comma-separated keywords, min 20 chars. e.g. 'cheerful, impulsive, secretly insecure'",
        "speaking_style": "Tone and speech habits, min 10 chars. e.g. 'Uses slang, ends with you know?'",
        "appearance": "Physical look for avatar, min 10 chars. e.g. 'Short red hair, round glasses, warm smile'",
        "intro_line": "Self-introduction line, min 10 chars. e.g. 'Hey, I'm Mira — let's get into it!'",
        "gender": "male or female — voice gender for this character. Must be exactly \"male\" or \"female\".",
        "age": "Voice age: exactly one of \"young\", \"middle_aged\", \"old\". Choose based on character."
      }},
      {{
        "agent_id": "",
        "name": "Character 2 name you invent",
        "concept": "2-4 sentences, min 20 chars.",
        "personality": "Comma-separated keywords, min 20 chars.",
        "speaking_style": "Tone and speech habits, min 10 chars.",
        "appearance": "Physical look, min 10 chars.",
        "intro_line": "Self-introduction, min 10 chars.",
        "gender": "male or female. Must be exactly \"male\" or \"female\".",
        "age": "Exactly one of \"young\", \"middle_aged\", \"old\"."
      }}
    ],
    "genre": {{ "main": "Max 30 chars.", "sub": "Max 30 chars." }},
    "worldview": {{ "time_period": "Max 50 chars.", "space": "Max 100 chars.", "tone": "Max 60 chars." }},
    "main_conflicts": {{ "surface": "Max 150 chars.", "internal": "Max 150 chars.", "relationship": "Max 150 chars." }},
    "character_fsm_schema": {{ "agent1": ["axis1_level", "axis2_level"], "agent2": ["axis1_level", "axis2_level"] }},
    "episode_type_weights": {{
      "setup": {{ "slice_of_life": 0.40, "comedy_incident": 0.40, "relationship_progress": 0.10, "mystery_hint": 0.05, "tension_episode": 0.05 }},
      "rising": {{ "slice_of_life": 0.35, "comedy_incident": 0.35, "relationship_progress": 0.15, "mystery_hint": 0.10, "tension_episode": 0.05 }},
      "midpoint": {{ "slice_of_life": 0.30, "comedy_incident": 0.30, "relationship_progress": 0.15, "mystery_hint": 0.10, "tension_episode": 0.15 }},
      "climax": {{ "slice_of_life": 0.25, "comedy_incident": 0.25, "relationship_progress": 0.15, "mystery_hint": 0.10, "tension_episode": 0.25 }},
      "resolution": {{ "slice_of_life": 0.40, "comedy_incident": 0.35, "relationship_progress": 0.15, "mystery_hint": 0.05, "tension_episode": 0.05 }}
    }}
  }},
  "arc_document": {{
    "season_goal": "2-3 sentences, max 200 chars.",
    "act1_transition_event": "1-2 sentences, max 200 chars.",
    "mid_reversal": "1-2 sentences, max 200 chars.",
    "climax_conditions": "1-2 sentences, max 200 chars."
  }},
  "proposed_agents": [
    {{ "name": "<same as characters[0].name>", "concept": "<same>", "personality": "<same>", "speaking_style": "<same>", "appearance": "<same>", "intro_line": "<same>", "gender": "<same as characters[0].gender>", "age": "<same as characters[0].age>" }},
    {{ "name": "<same as characters[1].name>", "concept": "<same>", "personality": "<same>", "speaking_style": "<same>", "appearance": "<same>", "intro_line": "<same>", "gender": "<same as characters[1].gender>", "age": "<same as characters[1].age>" }}
  ]
}}

IMPORTANT:
- Invent two contrasting, memorable characters. Each must have: name, concept (min 20 chars), personality (min 20), speaking_style (min 10), appearance (min 10), intro_line (min 10), gender (exactly "male" or "female"), age (exactly "young", "middle_aged", or "old" for voice casting). Same format as creating an agent.
- proposed_agents must be identical to series_document.characters (same name, concept, personality, speaking_style, appearance, intro_line, gender, age). Copy from characters.
- series_title must be creative and evocative — NOT just character names.
- character_fsm_schema: use snake_case names ending in _level for each character's two axes.
"""

    response = get_anthropic_client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=[{"type": "text", "text": system_msg}],
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text or ""
    usage = response.usage
    print(f"[series_doc_from_idea] tokens: input={usage.input_tokens}, output={usage.output_tokens}")

    cleaned = _clean_llm_json(raw)
    result = json.loads(cleaned)

    if "series_document" not in result or "arc_document" not in result:
        raise ValueError("LLM response missing series_document or arc_document")

    # Ensure characters have agent_id set to empty
    for c in result.get("series_document", {}).get("characters", []):
        c["agent_id"] = ""

    # If LLM omitted proposed_agents, build from characters (same 6 fields)
    if "proposed_agents" not in result or not result["proposed_agents"]:
        chars = result.get("series_document", {}).get("characters", [])
        result["proposed_agents"] = [
            {
                "name": c.get("name", ""),
                "concept": c.get("concept", ""),
                "personality": c.get("personality", ""),
                "speaking_style": c.get("speaking_style", ""),
                "appearance": c.get("appearance", ""),
                "intro_line": c.get("intro_line", ""),
                "gender": (c.get("gender") or "female").strip().lower() or "female",
                "age": _normalize_voice_age(c.get("age")),
            }
            for c in chars[:2]
        ]

    print(f"[series_doc_from_idea] Generated series + arc + proposed_agents for idea: {idea[:60]}...")
    return result


def refine_series_document(series_document, arc_document, instruction, series_title=None):
    """유저의 수정 요청에 따라 시리즈/아크 문서의 해당 부분만 수정한다."""
    system_msg = (
        "You are a series bible editor. The user wants to modify parts of an existing series document.\n"
        "Apply the requested changes while keeping everything else intact.\n"
        "Write ALL text in English. Return the COMPLETE updated documents as strictly valid JSON.\n"
    )

    title_block = f'\nCurrent series title: "{series_title}"' if series_title else ""

    prompt = f"""
Here is the current series document:
{json.dumps(series_document, indent=2, ensure_ascii=False)}

Here is the current arc document:
{json.dumps(arc_document, indent=2, ensure_ascii=False)}
{title_block}

User's modification request:
{instruction}

Apply the requested changes and return the FULL updated documents.
IMPORTANT:
- Preserve the character_fsm_schema and episode_type_weights fields in series_document. If the user's request changes character arcs significantly, update the FSM axes to match. If genre changes, adjust episode_type_weights accordingly.
- Each entry in series_document.characters has: name, concept, personality, speaking_style, appearance, intro_line, gender (exactly "male" or "female"), age ("young" | "middle_aged" | "old"). If the user asks to change a character's image, appearance, avatar, visual style, or personality, tone, voice age, etc., update the corresponding character fields (appearance for image/avatar, personality for traits, gender/age for voice casting). Keep the same structure and field lengths as before.
Output this exact JSON structure:
{{
  "series_title": "Updated title if relevant to the changes, otherwise keep current (max 40 chars)",
  "series_document": {{ ... complete updated series document including character_fsm_schema ... }},
  "arc_document": {{ ... complete updated arc document ... }}
}}
"""

    response = get_anthropic_client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=[{"type": "text", "text": system_msg}],
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text or ""
    usage = response.usage
    print(f"[refine_doc] tokens: input={usage.input_tokens}, output={usage.output_tokens}")

    cleaned = _clean_llm_json(raw)
    result = json.loads(cleaned)

    if "series_document" not in result or "arc_document" not in result:
        raise ValueError("LLM response missing series_document or arc_document")

    print(f"[refine_doc] Refined document with instruction: {instruction[:60]}...")
    return result


# ==========================================
# 시나리오 시스템 (Phase 2)
# ==========================================

EPISODE_TYPES = [
    "slice_of_life", "comedy_incident", "relationship_progress",
    "mystery_hint", "tension_episode",
]

SOFT_RESET_INTERVAL = 15  # 15화마다 soft_reset 강제

# 아크 단계별 에피소드 타입 목표 비율 (합 = 1.0)
ARC_PHASE_TYPE_WEIGHTS = {
    "setup": {
        "slice_of_life": 0.40, "comedy_incident": 0.40,
        "relationship_progress": 0.10, "mystery_hint": 0.05, "tension_episode": 0.05,
    },
    "rising": {
        "slice_of_life": 0.35, "comedy_incident": 0.35,
        "relationship_progress": 0.15, "mystery_hint": 0.10, "tension_episode": 0.05,
    },
    "midpoint": {
        "slice_of_life": 0.30, "comedy_incident": 0.30,
        "relationship_progress": 0.15, "mystery_hint": 0.10, "tension_episode": 0.15,
    },
    "climax": {
        "slice_of_life": 0.25, "comedy_incident": 0.25,
        "relationship_progress": 0.15, "mystery_hint": 0.10, "tension_episode": 0.25,
    },
    "resolution": {
        "slice_of_life": 0.40, "comedy_incident": 0.35,
        "relationship_progress": 0.15, "mystery_hint": 0.05, "tension_episode": 0.05,
    },
}


def _validate_custom_type_weights(custom_weights):
    """LLM이 생성한 episode_type_weights를 검증하고 정규화한다.
    각 타입의 비율은 최소 0.02, 최대 0.70으로 클램핑 후 합을 1.0으로 정규화."""
    if not custom_weights or not isinstance(custom_weights, dict):
        return None
    validated = {}
    for phase in ["setup", "rising", "midpoint", "climax", "resolution"]:
        phase_w = custom_weights.get(phase)
        if not phase_w or not isinstance(phase_w, dict):
            continue
        clamped = {}
        for ep_type in EPISODE_TYPES:
            val = phase_w.get(ep_type, 0)
            try:
                val = float(val)
            except (TypeError, ValueError):
                val = 0.0
            clamped[ep_type] = max(0.02, min(0.70, val))
        total = sum(clamped.values())
        if total > 0:
            validated[phase] = {t: v / total for t, v in clamped.items()}
    return validated if validated else None


def select_episode_types_for_choices(arc_phase, episode_type_counts, episode_number, n=3,
                                     custom_type_weights=None):
    """다음 에피소드 선택지 n개에 배정할 에피소드 타입을 확률적으로 선택한다.

    - arc_phase별 목표 비율 대비 부족한 타입에 가중치를 높여 비율을 유도한다.
    - 중복 허용: 같은 타입이 여러 선택지에 나올 수 있다.
    - 다음 화가 soft_reset 간격이면 None을 반환한다 (강제 soft_reset).
    - custom_type_weights: series_document.episode_type_weights (장르별 커스텀 비율)
    """
    next_ep = (episode_number or 0) + 1
    if next_ep % SOFT_RESET_INTERVAL == 0:
        return None  # 강제 soft_reset

    # 시리즈 문서에 장르별 커스텀 비율이 있으면 검증 후 사용, 없으면 기본값
    phase_weights = _validate_custom_type_weights(custom_type_weights) or ARC_PHASE_TYPE_WEIGHTS
    target = phase_weights.get(
        arc_phase, phase_weights.get("setup", ARC_PHASE_TYPE_WEIGHTS["setup"])
    )

    # 실제 사용 비율 계산
    total_main = sum(episode_type_counts.get(t, 0) for t in EPISODE_TYPES)

    # 목표 대비 부족분으로 가중치 조정
    weights = {}
    for ep_type in EPISODE_TYPES:
        target_ratio = target[ep_type]
        actual_ratio = episode_type_counts.get(ep_type, 0) / max(total_main, 1)
        deficit = target_ratio - actual_ratio
        # 부족한 타입은 부스트, 초과한 타입은 감소 (최소 0.05로 완전 배제 방지)
        adjusted = target_ratio * max(0.05, 1.0 + deficit * 3.0)
        weights[ep_type] = adjusted

    # 정규화
    total_w = sum(weights.values())
    if total_w <= 0:
        # 모든 가중치가 0이면 균등 분배
        weights = {t: 1.0 / len(EPISODE_TYPES) for t in EPISODE_TYPES}
        total_w = 1.0
    for t in weights:
        weights[t] /= total_w

    # 중복 허용 가중치 샘플링
    types = list(weights.keys())
    w = [weights[t] for t in types]
    selected = random.choices(types, weights=w, k=n)

    print(f"[episode_type_select] arc={arc_phase}, counts={episode_type_counts}, "
          f"weights={{{', '.join(f'{t}: {weights[t]:.2f}' for t in types)}}}, "
          f"selected={selected}")
    return selected


def get_episode_type(episode_number):
    """에피소드 번호에 따라 타입을 자동 결정 (레거시 폴백)."""
    if episode_number and episode_number % SOFT_RESET_INTERVAL == 0:
        return "soft_reset"
    return EPISODE_TYPES[((episode_number or 1) - 1) % len(EPISODE_TYPES)]


def generate_scenario(host1, host2, series_document, arc_document,
                      story_context=None, episode_number=1, user_choice=None,
                      episode_type=None, character_fsm=None,
                      rolling_summary=None, core_memory=None, language=None):
    """에피소드 시나리오를 생성한다 (스크립트 생성 이전 단계)."""
    ep_type = episode_type or get_episode_type(episode_number)

    # 컨텍스트 조립
    # rolling_summary가 있으면 그것으로 대체 (story_context 전체 전달 불필요)
    # rolling_summary가 없을 때만 story_context 마지막 3개 폴백
    recent_summaries = ""
    if not rolling_summary and story_context and isinstance(story_context, list):
        last_3 = story_context[-3:]
        for ep in last_3:
            recent_summaries += f"\n  Episode {ep.get('episode', '?')}: {ep.get('summary', '')}"

    core_events = ""
    open_threads_str = ""
    foreshadowing_str = ""
    if core_memory and isinstance(core_memory, dict):
        events = core_memory.get("key_events", [])
        if events:
            core_events = "\n  ".join(str(e) for e in events)
        secrets = core_memory.get("revealed_secrets", [])
        if secrets:
            core_events += "\n  Revealed secrets: " + ", ".join(str(s) for s in secrets)

        threads = core_memory.get("open_threads", [])
        if threads:
            open_threads_str = "\n".join(f"  - {t}" for t in threads)

        fs_items = core_memory.get("foreshadowing", [])
        if fs_items:
            # 회수 권장 구간에 있는 항목 먼저, 나머지는 참고용
            due_now = []
            open_fs = []
            for fs in fs_items:
                if fs.get("status") in ("resolved",):
                    continue
                r = fs.get("target_ep_range", [])
                if isinstance(r, list) and len(r) == 2:
                    if r[0] <= episode_number <= r[1]:
                        due_now.append(fs)
                    else:
                        open_fs.append(fs)
                else:
                    open_fs.append(fs)
            lines = []
            for fs in due_now:
                lines.append(f"  *** DUE NOW *** \"{fs.get('hint')}\" (planted EP{fs.get('planted_ep')}) — {fs.get('note','')}")
            for fs in open_fs:
                lines.append(f"  [{fs.get('status','open')}] \"{fs.get('hint')}\" (planted EP{fs.get('planted_ep')}, target EP{fs.get('target_ep_range')}) — {fs.get('note','')}")
            foreshadowing_str = "\n".join(lines)

    fsm_str = ""
    if character_fsm and isinstance(character_fsm, dict):
        fsm_str = json.dumps(character_fsm, indent=2)

    # FSM 스키마 — series_document에서 동적으로 결정된 축 사용
    fsm_schema = series_document.get("character_fsm_schema", {})
    agent1_axes = fsm_schema.get("agent1", ["trust_level", "attachment_level"])
    agent2_axes = fsm_schema.get("agent2", ["suspicion_level", "openness_level"])

    # 시리즈 문서에서 캐릭터 정보 추출
    chars = series_document.get("characters", [])
    char1_info = chars[0] if len(chars) > 0 else {}
    char2_info = chars[1] if len(chars) > 1 else {}

    system_msg = (
        "You are a drama scenario planner for an audio drama series.\n"
        "Create a detailed scenario for ONE episode. This is NOT the script — it's the story outline.\n"
        "The scenario will be validated and then used to generate the actual script.\n"
        f"{_lang_directive(language)} Return strictly valid JSON.\n"
    )

    soft_reset_note = ""
    if ep_type == "soft_reset":
        soft_reset_note = (
            "\n\nSOFT RESET EPISODE: This is a standalone episode. "
            "No main plot progression. Focus on character charm and warmth. "
            "A new viewer should enjoy this episode alone without prior context.\n"
        )

    prompt = f"""
=== SERIES BIBLE (IMMUTABLE) ===
Genre: {json.dumps(series_document.get('genre', {}))}
Worldview: {json.dumps(series_document.get('worldview', {}))}
Main Conflicts:
- Surface: {series_document.get('main_conflicts', {}).get('surface', '')}
- Internal: {series_document.get('main_conflicts', {}).get('internal', '')}
- Relationship: {series_document.get('main_conflicts', {}).get('relationship', '')}

Character 1 — {char1_info.get('name', host1.get('name', 'Agent 1'))}:
- Background: {char1_info.get('background', '')}
- Personality: {char1_info.get('personality', '')}
- Secret: {char1_info.get('secret', '')}

Character 2 — {char2_info.get('name', host2.get('name', 'Agent 2'))}:
- Background: {char2_info.get('background', '')}
- Personality: {char2_info.get('personality', '')}
- Secret: {char2_info.get('secret', '')}

=== ARC DOCUMENT (IMMUTABLE) ===
Season Goal: {arc_document.get('season_goal', '')}
Act 1 Transition: {arc_document.get('act1_transition_event', '')}
Mid Reversal: {arc_document.get('mid_reversal', '')}
Climax Conditions: {arc_document.get('climax_conditions', '')}

=== ROLLING SUMMARY (500 char compressed history) ===
{rolling_summary or '(First episode — no history)'}

=== CORE MEMORY (permanent events) ===
{core_events or '(None yet)'}

=== OPEN THREADS (unresolved mysteries) ===
{open_threads_str or '(None yet)'}

=== FORESHADOWING (planted details to pay off) ===
{foreshadowing_str or '(None yet)'}
Items marked *** DUE NOW *** should be actively developed or paid off this episode.

=== RECENT EPISODES (last 3) ===
{recent_summaries or '(None yet)'}

=== CHARACTER EMOTION FSM ===
{fsm_str or '(Not initialized)'}

=== THIS EPISODE ===
Episode number: {episode_number}
Episode type: {ep_type}
User's chosen direction: {user_choice or '(None — first episode or free choice)'}
{soft_reset_note}

Generate a scenario. Output this JSON:
{{
  "episode_number": {episode_number},
  "title": "Episode title (max 60 chars)",
  "episode_type": "{ep_type}",
  "focused_emotion": {{
    "agent1": "The ONE core emotion for {char1_info.get('name', 'Agent 1')} this episode",
    "agent2": "The ONE core emotion for {char2_info.get('name', 'Agent 2')} this episode"
  }},
  "event_summary": "What happens in this episode (2-3 sentences)",
  "setting": {{
    "space": "WHERE the scene takes place",
    "time": "WHEN (time of day, season, etc.)"
  }},
  "character_state_changes": {{
    "agent1": {{ {', '.join(f'"{ax}": 0' for ax in agent1_axes)} }},
    "agent2": {{ {', '.join(f'"{ax}": 0' for ax in agent2_axes)} }}
  }}
}}

RULES:
- focused_emotion: EXACTLY 1 emotion per character. No splitting.
- character_state_changes: values must be -1, 0, or +1 only.
- event_summary must fit in a 60-second audio clip.
"""

    response = get_anthropic_client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=[{"type": "text", "text": system_msg}],
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text or ""
    usage = response.usage
    print(f"[scenario] tokens: input={usage.input_tokens}, output={usage.output_tokens}")

    cleaned = _clean_llm_json(raw)
    scenario = json.loads(cleaned)
    print(f"[scenario] Generated scenario for ep {episode_number}: {scenario.get('title', '')}")
    return scenario


def validate_scenario(scenario, series_document, arc_document,
                      story_context=None, episode_number=1,
                      character_fsm=None):
    """시나리오 검증 게이트 — Writer/Editor 분리 원칙."""
    system_msg = (
        "You are a drama editor reviewing a scenario for quality and consistency.\n"
        "Check against the provided criteria and return your assessment.\n"
        "If the scenario has issues, fix them in the fixed_scenario field.\n"
        "Return strictly valid JSON.\n"
    )

    prompt = f"""
=== SCENARIO TO VALIDATE ===
{json.dumps(scenario, indent=2, ensure_ascii=False)}

=== SERIES DOCUMENT ===
{json.dumps(series_document, indent=2, ensure_ascii=False)}

=== ARC DOCUMENT ===
{json.dumps(arc_document, indent=2, ensure_ascii=False)}

=== VALIDATION CONTEXT ===
Episode number: {episode_number}
Current character FSM: {json.dumps(character_fsm or {}, indent=2)}

=== VALIDATION CHECKLIST ===
1. DURATION: Can this event summary be told in a 60-second audio scene? (Not too complex, not too thin)
2. EMOTIONAL FOCUS: Is there exactly 1 focused emotion per character? (Not 2+, not vague)
3. CHARACTER CONSISTENCY: Do character_state_changes stay within ±1? Do they align with each character's personality?
4. ARC ALIGNMENT: Does this episode fit the overall season goal and current arc phase?

Output JSON:
{{
  "valid": true or false,
  "issues": ["List of specific issues found, empty if valid"],
  "fixed_scenario": {{ ... complete corrected scenario if invalid, null if valid ... }}
}}
"""

    completion = get_openai_client().chat.completions.create(
        model="gpt-5.2",
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
    )

    raw = completion.choices[0].message.content or ""
    usage = completion.usage
    print(f"[validate] tokens: input={usage.prompt_tokens}, output={usage.completion_tokens}")

    cleaned = _clean_llm_json(raw)
    result = json.loads(cleaned)
    valid = result.get("valid", False)
    issues = result.get("issues", [])
    print(f"[validate] Scenario valid={valid}, issues={len(issues)}")
    if issues:
        for iss in issues:
            print(f"  - {iss}")
    return result


def _sanitize_script_lines(lines, host1, host2):
    """스크립트 라인 하드체크 + 자동 교정.

    1. speaker ID 오류 — 캐릭터 이름으로 쓴 경우 ID로 교정
    2. emotion 필드에 물리적 액션 포함 시 제거
    3. 라인 수 상한 (30줄) 초과 시 트림
    """
    import re

    # 이름 → ID 매핑 (대소문자 무시)
    name_to_id = {}
    for agent in (host1, host2):
        agent_id = agent.get("id", "")
        agent_name = agent.get("name", "")
        if agent_id and agent_name:
            name_to_id[agent_name.lower()] = agent_id

    valid_ids = {host1.get("id", ""), host2.get("id", ""), "sfx", "narration"} - {""}

    # 물리적 액션 패턴 (emotion 필드에 있으면 안 됨)
    _PHYSICAL_ACTION_RE = re.compile(
        r'\b(slam|grab|walk|throw|punch|kick|run|lunge|turn|step|reach|pull|push|shove|slam|drop|pick up|stand|sit|lean|cross)\b',
        re.IGNORECASE,
    )

    sanitized = []
    for line in lines:
        spk = line.get("speaker", "")

        # 1. speaker ID 교정: 이름으로 쓴 경우
        if spk not in valid_ids:
            corrected = name_to_id.get(spk.lower())
            if corrected:
                print(f"[sanitize] speaker name→id: '{spk}' → '{corrected}'")
                line = dict(line)
                line["speaker"] = corrected
            else:
                print(f"[sanitize] unknown speaker '{spk}' — dropping line")
                continue

        # 2. emotion 필드 물리액션 제거
        emotion = line.get("emotion", "")
        if emotion and _PHYSICAL_ACTION_RE.search(emotion):
            print(f"[sanitize] physical action in emotion field — clearing: '{emotion[:60]}'")
            line = dict(line)
            line["emotion"] = ""

        sanitized.append(line)

    # 3. 라인 수 상한
    if len(sanitized) > 30:
        print(f"[sanitize] too many lines ({len(sanitized)}) — trimming to 30")
        sanitized = sanitized[:30]

    return sanitized


def _enforce_scenario_constraints(scenario):
    """하드 엔포스먼트: FSM state_changes ±1 범위 강제 클램핑."""
    if not scenario or not isinstance(scenario, dict):
        return scenario

    state_changes = scenario.get("character_state_changes", {})
    if state_changes and isinstance(state_changes, dict):
        for agent_key, changes in state_changes.items():
            if not isinstance(changes, dict):
                continue
            for attr, delta in changes.items():
                try:
                    delta_val = int(delta)
                except (ValueError, TypeError):
                    changes[attr] = 0
                    continue
                if delta_val < -1 or delta_val > 1:
                    print(f"[hard_enforce] FSM clamped {agent_key}.{attr}: {delta_val} → {max(-1, min(1, delta_val))}")
                    changes[attr] = max(-1, min(1, delta_val))

    return scenario


def generate_and_validate_scenario(host1, host2, series_document, arc_document,
                                   story_context=None, episode_number=1, user_choice=None,
                                   episode_type=None, character_fsm=None,
                                   rolling_summary=None, core_memory=None, language=None):
    """시나리오 생성 + 하드 엔포스먼트."""
    scenario = generate_scenario(
        host1, host2, series_document, arc_document,
        story_context=story_context, episode_number=episode_number,
        user_choice=user_choice, episode_type=episode_type,
        character_fsm=character_fsm,
        rolling_summary=rolling_summary, core_memory=core_memory,
        language=language,
    )

    # --- 하드 엔포스먼트: FSM ±1 클램핑 ---
    scenario = _enforce_scenario_constraints(scenario)

    return scenario


# ==========================================
# 3계층 메모리 시스템 (Phase 3)
# ==========================================

def update_rolling_summary(existing_summary, new_episode_summary):
    """롤링 요약 (Mid Memory): 기존 + 새 에피소드 → 500자 이내 재압축."""
    new_summary_text = new_episode_summary.get("summary", "") if isinstance(new_episode_summary, dict) else str(new_episode_summary)

    prompt = f"""
Compress the following story history into a single rolling summary.
Keep it under 500 characters. Recent events should be more detailed, older events condensed to essentials.

EXISTING ROLLING SUMMARY:
{existing_summary or '(None — first episode)'}

NEW EPISODE SUMMARY:
{new_summary_text}

KEY EVENTS FROM NEW EPISODE:
{json.dumps(new_episode_summary.get('key_events', []) if isinstance(new_episode_summary, dict) else [])}

Output strictly valid JSON:
{{ "rolling_summary": "Compressed summary under 500 characters" }}
"""

    completion = get_openai_client().chat.completions.create(
        model="gpt-5-mini",
        messages=[
            {"role": "system", "content": "Compress story history into concise rolling summaries. Output JSON only."},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
    )

    raw = _clean_llm_json(completion.choices[0].message.content)
    result = json.loads(raw)
    summary = result.get("rolling_summary", "")
    if len(summary) > 500:
        summary = summary[:500]
    print(f"[rolling_summary] Updated: {len(summary)} chars")
    return summary


def update_core_memory(script_lines, episode_number, existing_core_memory, host1, host2,
                       arc_document=None, current_arc_phase=None):
    """Core Memory 업데이트:
    - key_events: 되돌릴 수 없는 이벤트
    - revealed_secrets: 공개된 비밀
    - relationship_status: 관계 상태
    - open_threads: 아직 답이 안 난 장기 실마리
    - foreshadowing: 심어진 복선 + 회수 계획 (status: open/triggered/resolved)
    arc_document가 주어지면 arc_phase도 함께 판단한다.
    """
    dialogue_text = "\n".join(
        f"{line.get('speaker', '?')}: {line.get('text', '')}"
        for line in script_lines
        if line.get("text")
    )[:3000]

    arc_phase_block = ""
    arc_phase_instruction = ""
    arc_phase_field = ""
    if arc_document:
        arc_phase_block = f"""
ARC DOCUMENT (for arc phase judgment):
- Season Goal: {(arc_document.get('season_goal') or '')[:300]}
- Act 1 Transition: {(arc_document.get('act1_transition_event') or '')[:300]}
- Mid Reversal: {(arc_document.get('mid_reversal') or '')[:300]}
- Climax Conditions: {(arc_document.get('climax_conditions') or '')[:300]}
Current arc_phase before this episode: {current_arc_phase or 'setup'}
"""
        arc_phase_instruction = """
ARC PHASE JUDGMENT:
Determine arc_phase AFTER this episode. Phases: "setup"→"rising"→"midpoint"→"climax"→"resolution"
Advance only if arc document transition conditions are clearly met. Do NOT advance based on episode number alone.
"""
        arc_phase_field = ',\n  "arc_phase": "setup|rising|midpoint|climax|resolution"'

    prompt = f"""
Analyze this drama episode and update the series memory.
{arc_phase_instruction}
EXISTING CORE MEMORY:
{json.dumps(existing_core_memory, indent=2, ensure_ascii=False)}
{arc_phase_block}
EPISODE {episode_number} SCRIPT:
{dialogue_text}

Characters: {host1.get('name', 'Agent 1')}, {host2.get('name', 'Agent 2')}

Output JSON:
{{
  "has_updates": true/false,
  "new_key_events": ["Irreversible events only: first meeting, betrayal, death, major decisions"],
  "new_revealed_secrets": ["Secrets or hidden facts explicitly revealed this episode"],
  "relationship_status_update": {{"{host1.get('name', 'agent1')}": "status", "{host2.get('name', 'agent2')}": "status"}} or null,

  "open_threads_update": {{
    "add": ["New specific unresolved questions introduced this episode (unexplained sounds, unnamed people, locked doors, unanswered questions)"],
    "resolve": ["Exact text of existing open_threads items that were clearly answered this episode"]
  }},

  "foreshadowing_update": {{
    "add": [
      {{
        "hint": "The specific detail/phrase/object planted (max 80 chars)",
        "planted_ep": {episode_number},
        "target_ep_range": [low, high],
        "note": "What this is likely setting up (max 120 chars)"
      }}
    ],
    "trigger": ["hint text of foreshadowing items that reappeared or were developed but not yet resolved"],
    "resolve": ["hint text of foreshadowing items that were fully paid off this episode"]
  }}{arc_phase_field}
}}

RULES:
- open_threads.add: Be specific. "Who is the gum-chewing tech?" not "mystery person".
- open_threads.resolve: Only if clearly answered in this episode.
- foreshadowing.add: Only deliberate narrative plants (repeated motifs, symbolic objects, unexplained specifics). Max 2 per episode.
- foreshadowing.target_ep_range: Estimate payoff window (e.g. [8,12]).
- has_updates: true if ANY field has non-empty additions.
"""

    completion = get_openai_client().chat.completions.create(
        model="gpt-5-mini",
        messages=[
            {"role": "system", "content": (
                "You are a story continuity analyst for an audio drama series. "
                "Track unresolved mysteries, planted foreshadowing, and core narrative events. "
                "Be specific and conservative. Output JSON only."
            )},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
    )

    raw = _clean_llm_json(completion.choices[0].message.content)
    result = json.loads(raw)

    updated_memory = dict(existing_core_memory) if existing_core_memory else {}
    updated_memory.setdefault("key_events", [])
    updated_memory.setdefault("revealed_secrets", [])
    updated_memory.setdefault("relationship_status", {})
    updated_memory.setdefault("open_threads", [])
    updated_memory.setdefault("foreshadowing", [])

    if result.get("has_updates"):
        for event in result.get("new_key_events", []):
            if event:
                updated_memory["key_events"].append(f"Ep{episode_number}: {event}")
        for secret in result.get("new_revealed_secrets", []):
            if secret:
                updated_memory["revealed_secrets"].append(secret)
        status_update = result.get("relationship_status_update")
        if status_update and isinstance(status_update, dict):
            updated_memory["relationship_status"].update(status_update)

        # open_threads
        threads_upd = result.get("open_threads_update", {})
        for thread in threads_upd.get("add", []):
            if thread and thread not in updated_memory["open_threads"]:
                updated_memory["open_threads"].append(thread)
        resolve_set = set(threads_upd.get("resolve", []))
        if resolve_set:
            updated_memory["open_threads"] = [
                t for t in updated_memory["open_threads"] if t not in resolve_set
            ]

        # foreshadowing
        fs_upd = result.get("foreshadowing_update", {})
        for item in fs_upd.get("add", []):
            if item.get("hint"):
                item.setdefault("status", "open")
                updated_memory["foreshadowing"].append(item)
        trigger_hints = set(fs_upd.get("trigger", []))
        resolve_hints = set(fs_upd.get("resolve", []))
        for fs in updated_memory["foreshadowing"]:
            hint = fs.get("hint", "")
            if hint in resolve_hints:
                fs["status"] = "resolved"
            elif hint in trigger_hints and fs.get("status") == "open":
                fs["status"] = "triggered"

        print(f"[core_memory] Ep{episode_number}: "
              f"+{len(result.get('new_key_events', []))} events, "
              f"+{len(threads_upd.get('add', []))} threads, "
              f"+{len(fs_upd.get('add', []))} foreshadowing")
    else:
        print(f"[core_memory] No significant events in episode {episode_number}")

    new_arc_phase = result.get("arc_phase") if arc_document else None
    valid_phases = {"setup", "rising", "midpoint", "climax", "resolution"}
    if new_arc_phase not in valid_phases:
        new_arc_phase = None

    print(f"[core_memory] arc_phase={new_arc_phase or '(not determined)'}")
    return updated_memory, new_arc_phase


def update_character_fsm(scenario_state_changes, existing_fsm):
    """캐릭터 감정 FSM 업데이트 — 순수 로직 (±1 클램핑, 1~5 범위)."""
    fsm = dict(existing_fsm) if existing_fsm else {}

    if not scenario_state_changes or not isinstance(scenario_state_changes, dict):
        return fsm

    for agent_key, changes in scenario_state_changes.items():
        if not isinstance(changes, dict):
            continue
        if agent_key not in fsm:
            fsm[agent_key] = {}
        for attr, delta in changes.items():
            try:
                delta_val = int(delta)
            except (ValueError, TypeError):
                continue
            delta_val = max(-1, min(1, delta_val))  # clamp ±1
            current = fsm[agent_key].get(attr, 3)  # default midpoint
            new_val = max(1, min(5, current + delta_val))  # clamp 1~5
            fsm[agent_key][attr] = new_val

    print(f"[fsm] Updated: {json.dumps(fsm)}")
    return fsm


def determine_arc_phase(episode_number, total_episodes, core_memory, arc_document):
    """아크 단계를 결정한다."""
    if not arc_document:
        return "setup"

    key_events = []
    if core_memory and isinstance(core_memory, dict):
        key_events = core_memory.get("key_events", [])
    events_text = " ".join(str(e) for e in key_events).lower()

    act1_event = (arc_document.get("act1_transition_event") or "").lower()
    mid_reversal = (arc_document.get("mid_reversal") or "").lower()
    climax_cond = (arc_document.get("climax_conditions") or "").lower()

    # 이벤트 발생 감지 (키워드 매칭)
    act1_happened = False
    mid_happened = False
    climax_happened = False

    if act1_event:
        keywords = [w for w in act1_event.split() if len(w) > 3][:5]
        act1_happened = sum(1 for k in keywords if k in events_text) >= 2
    if mid_reversal:
        keywords = [w for w in mid_reversal.split() if len(w) > 3][:5]
        mid_happened = sum(1 for k in keywords if k in events_text) >= 2
    if climax_cond:
        keywords = [w for w in climax_cond.split() if len(w) > 3][:5]
        climax_happened = sum(1 for k in keywords if k in events_text) >= 2

    if climax_happened:
        return "climax"
    if mid_happened:
        return "midpoint"
    if act1_happened:
        return "rising"

    # 비율 기반 폴백
    if total_episodes:
        ratio = episode_number / total_episodes
        if ratio >= 0.85:
            return "resolution"
        if ratio >= 0.65:
            return "climax"
        if ratio >= 0.4:
            return "midpoint"
        if ratio >= 0.2:
            return "rising"
        return "setup"

    # open-ended 휴리스틱
    if episode_number <= 3:
        return "setup"
    if episode_number <= 8:
        return "rising"
    if episode_number <= 12:
        return "midpoint"
    return "rising"  # open-ended는 rising에 머무름


async def produce_clip(title, agent1_id, agent2_id, agents_map, max_seconds=60.0, script=None,
                       setting=None, situation=None,
                       core_emotion=None, relationship_state=None, tone=None,
                       series_context=None, arc_phase=None, episode_number=None,
                       total_episodes=None, relationship_context=None,
                       series_document=None, arc_document=None,
                       rolling_summary=None, core_memory=None,
                       character_fsm=None,
                       episode_type=None, episode_type_counts=None,
                       language=None):
    if agent1_id == agent2_id:
        raise ValueError("agent1_id and agent2_id must be different")
    if agent1_id not in agents_map or agent2_id not in agents_map:
        raise ValueError("Unknown agent id")

    host1 = agents_map[agent1_id]
    host2 = agents_map[agent2_id]

    clip_id = uuid.uuid4().hex[:8]

    # --- 시리즈 파이프라인 (시리즈 문서가 있을 때) ---
    scenario = None
    is_series_pipeline = bool(series_document and arc_document and episode_number)

    if is_series_pipeline and not (script and isinstance(script, list) and len(script) > 0):
        print(f"[produce_clip] Series pipeline mode — episode {episode_number}")

        # 1. 에피소드 타입 결정 (전달된 타입 우선, 없으면 레거시 폴백)
        ep_type = episode_type or get_episode_type(episode_number)
        print(f"[produce_clip] Episode type: {ep_type} (from={'param' if episode_type else 'fallback'})")

        # 2. 아크 단계 결정
        arc_phase = determine_arc_phase(episode_number, total_episodes, core_memory, arc_document)
        print(f"[produce_clip] Arc phase: {arc_phase}")

        # 3. 시나리오 생성 + 검증
        user_choice = situation or core_emotion or None  # 유저 선택지를 situation/core_emotion에서 추출
        scenario = generate_and_validate_scenario(
            host1, host2, series_document, arc_document,
            story_context=series_context, episode_number=episode_number,
            user_choice=user_choice, episode_type=ep_type,
            character_fsm=character_fsm,
            rolling_summary=rolling_summary, core_memory=core_memory,
            language=language,
        )

        # 4. 시나리오에서 스크립트 입력 추출
        scenario_setting = scenario.get("setting", {})
        setting = f"{scenario_setting.get('space', '')} — {scenario_setting.get('time', '')}" if isinstance(scenario_setting, dict) else str(scenario_setting)
        situation = scenario.get("event_summary", situation or "")
        focused = scenario.get("focused_emotion", {})
        core_emotion = focused.get("agent1", "") + " / " + focused.get("agent2", "")
        relationship_state = relationship_state or ""
        tone = tone or ""
        title = scenario.get("title", title)

    series_kwargs = {}
    if series_context is not None and episode_number:
        series_kwargs = dict(
            series_context=series_context, arc_phase=arc_phase,
            episode_number=episode_number, total_episodes=total_episodes,
            relationship_context=relationship_context,
        )
    # 시리즈 문서/아크 문서를 스크립트 생성에 전달
    if series_document:
        series_kwargs["series_document"] = series_document
    if arc_document:
        series_kwargs["arc_document"] = arc_document
    # 에피소드 타입을 스크립트 생성에 전달
    if is_series_pipeline:
        series_kwargs["episode_type"] = scenario.get("episode_type") if scenario else get_episode_type(episode_number)
    if language:
        series_kwargs["language"] = language

    if script and isinstance(script, list) and len(script) > 0:
        print(f"[produce_clip] using provided script ({len(script)} lines)")
    else:
        script = generate_clip_script(host1, host2, title, setting, situation,
                                      core_emotion=core_emotion, relationship_state=relationship_state, tone=tone,
                                      **series_kwargs)

    # --- 배경 이미지 생성 (TTS와 병렬) ---
    bg_image_task = None
    try:
        bg_prompt = _build_background_image_prompt(title, setting, situation, core_emotion, tone)
        if bg_prompt:
            bg_image_task = asyncio.create_task(_generate_background_image_async(bg_prompt))
    except Exception as e:
        print(f"[produce_clip] Failed to start background image task: {e}", flush=True)

    tmp_dir = tempfile.mkdtemp(prefix="clip_")
    os.chmod(tmp_dir, 0o700)
    try:
        temp_files = []
        transcript_data = []
        current_time = 0.0
        safety_margin = 2.0

        for i, line in enumerate(script):
            speaker_id = line.get("speaker")
            text = (line.get("text") or "").strip()
            if not speaker_id or not text:
                continue

            is_sfx = speaker_id == "sfx"
            is_narration = speaker_id == "narration"
            temp_filename = os.path.join(tmp_dir, f"temp_{clip_id}_{i}.mp3")

            if is_sfx:
                try:
                    await generate_sfx_audio(text, temp_filename)
                    _normalize_sfx_volume(temp_filename)
                except Exception as e:
                    print(f"[SFX] generation failed for '{text}', skipping: {e}", flush=True)
                    continue
            elif is_narration:
                text = _ensure_sentence_end(text)
                narration_voice = os.environ.get("NARRATION_VOICE_ID") or ELEVENLABS_VOICE_ID or "nPczCjzI2devNBz1zQrb"  # Brian — deep narration
                await generate_audio_line(text, narration_voice, "+0%", "+0Hz", temp_filename)
            else:
                text = _ensure_sentence_end(text)
                emotion = line.get("emotion", "")
                audio_tag = _emotion_to_audio_tag(emotion)
                if audio_tag:
                    text = f"{audio_tag} {text}"
                if speaker_id not in agents_map:
                    continue
                agent = agents_map[speaker_id]
                voice_arg = agent.get("elevenlabs_voice_id") or agent.get("voice", "")
                await generate_audio_line(
                    text,
                    voice_arg,
                    agent.get("rate", "+0%"),
                    agent.get("pitch", "+0Hz"),
                    temp_filename,
                )

            duration = get_audio_duration(temp_filename)
            if current_time + duration > (max_seconds - safety_margin):
                if os.path.exists(temp_filename):
                    os.remove(temp_filename)
                break

            temp_files.append(temp_filename)

            if is_sfx:
                entry = {
                    "speaker": speaker_id,
                    "start": round(current_time, 2),
                    "end": round(current_time + duration, 2),
                    "text": text,
                    "type": "sfx",
                }
                transcript_data.append(entry)
            elif is_narration:
                chunks = _split_subtitle_chunks(text, max_words=7)
                chunk_dur = duration / len(chunks)
                for ci, chunk in enumerate(chunks):
                    transcript_data.append({
                        "speaker": "narration",
                        "start": round(current_time + ci * chunk_dur, 2),
                        "end": round(current_time + (ci + 1) * chunk_dur, 2),
                        "text": chunk,
                        "type": "narration",
                    })
            else:
                chunks = _split_subtitle_chunks(text, max_words=7)
                chunk_dur = duration / len(chunks)
                for ci, chunk in enumerate(chunks):
                    transcript_data.append({
                        "speaker": speaker_id,
                        "start": round(current_time + ci * chunk_dur, 2),
                        "end": round(current_time + (ci + 1) * chunk_dur, 2),
                        "text": chunk,
                    })
            current_time += duration

        if not temp_files:
            raise RuntimeError("Clip generation produced no audio")

        final_mp3 = os.path.join(tmp_dir, f"{clip_id}.mp3")
        combine_audio_ffmpeg(temp_files, final_mp3)

        with open(final_mp3, "rb") as f:
            mp3_bytes = f.read()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    # --- 배경 이미지 결과 수집 ---
    background_image_b64 = None
    if bg_image_task is not None:
        try:
            bg_bytes = await bg_image_task
            if bg_bytes:
                background_image_b64 = base64.b64encode(bg_bytes).decode()
                print(f"[produce_clip] Background image generated ({len(bg_bytes)} bytes)")
        except Exception as e:
            print(f"[produce_clip] Background image generation failed (non-fatal): {e}", flush=True)

    meta = {
        "id": clip_id,
        "title": title,
        "setting": setting or "",
        "situation": situation or "",
        "core_emotion": core_emotion or "",
        "relationship_state": relationship_state or "",
        "tone": tone or "",
        "agents": [agent1_id, agent2_id],
        "duration_seconds": round(current_time, 2),
        "mp3_b64": base64.b64encode(mp3_bytes).decode(),
        "transcript_json": transcript_data,
    }
    if background_image_b64:
        meta["background_image_b64"] = background_image_b64

    # 시리즈 클립이면 에피소드 요약 + 메모리 업데이트 + 다음 선택지 생성
    if episode_number and (series_kwargs or is_series_pipeline):
        try:
            episode_summary, new_rolling_inline = generate_episode_summary(
                script, host1, host2, episode_number,
                existing_rolling_summary=rolling_summary if is_series_pipeline else None,
            )
            meta["episode_summary"] = episode_summary

            # 시나리오 정보 저장
            if scenario:
                meta["scenario"] = scenario
            meta["episode_type"] = ep_type if is_series_pipeline else (
                scenario.get("episode_type", get_episode_type(episode_number)) if scenario else get_episode_type(episode_number)
            )

            # --- 3계층 메모리 업데이트 (시리즈 문서가 있을 때만) ---
            if is_series_pipeline:
                try:
                    # 롤링 요약 — generate_episode_summary에서 인라인으로 생성됨
                    if new_rolling_inline is not None:
                        new_rolling = new_rolling_inline
                    else:
                        # 폴백: 별도 호출 (rolling_summary가 None으로 반환된 경우)
                        new_rolling = update_rolling_summary(rolling_summary or "", episode_summary)
                    meta["rolling_summary"] = new_rolling

                    # Core Memory 업데이트 + arc_phase LLM 판단
                    new_core, llm_arc_phase = update_core_memory(
                        script, episode_number, core_memory or {}, host1, host2,
                        arc_document=arc_document, current_arc_phase=arc_phase,
                    )
                    meta["core_memory"] = new_core
                    # LLM 판단 결과 우선, 없으면 기존 휴리스틱 폴백
                    resolved_arc_phase = llm_arc_phase or arc_phase
                    meta["arc_phase"] = resolved_arc_phase

                    # FSM 업데이트
                    state_changes = scenario.get("character_state_changes", {}) if scenario else {}
                    new_fsm = update_character_fsm(state_changes, character_fsm or {})
                    meta["character_fsm"] = new_fsm

                except Exception as e:
                    print(f"[produce_clip] memory update failed: {e}")
                    import traceback
                    traceback.print_exc()
                    meta["memory_update_error"] = str(e)

            # --- 에피소드 타입 사용 이력 업데이트 + 다음 선택지 생성 ---
            try:
                current_ep_type = meta.get("episode_type", get_episode_type(episode_number))
                ep_counts = dict(episode_type_counts or {})
                ep_counts[current_ep_type] = ep_counts.get(current_ep_type, 0) + 1
                meta["episode_type_counts"] = ep_counts

                # 다음 화의 아크 단계 — LLM 판단 결과 우선, 없으면 휴리스틱
                next_arc_phase = meta.get("arc_phase") or determine_arc_phase(
                    (episode_number or 0) + 1, total_episodes,
                    meta.get("core_memory", core_memory), arc_document,
                )

                # 다음 선택지에 배정할 에피소드 타입 선택
                custom_weights = (series_document or {}).get("episode_type_weights")
                selected_types = select_episode_types_for_choices(
                    next_arc_phase, ep_counts, episode_number,
                    custom_type_weights=custom_weights,
                )

                if selected_types is None:
                    # 강제 soft_reset
                    meta["next_options"] = {
                        "forced_next_type": "soft_reset",
                        "options": [],
                    }
                    print(f"[produce_clip] Next episode forced: soft_reset")
                else:
                    next_opts = generate_next_options(
                        episode_summary, host1, host2,
                        story_context=series_context,
                        setting=setting,
                        episode_types=selected_types,
                        series_document=series_document,
                        arc_document=arc_document,
                        core_memory=meta.get("core_memory", core_memory),
                        rolling_summary=meta.get("rolling_summary", rolling_summary),
                        arc_phase=meta.get("arc_phase") or next_arc_phase,
                    )
                    meta["next_options"] = {
                        "forced_next_type": None,
                        "options": next_opts,
                    }
            except Exception as e:
                print(f"[produce_clip] next options generation failed, skipping: {e}")
        except Exception as e:
            print(f"[produce_clip] episode summary generation failed, skipping: {e}")

    return meta

def generate_agent_spec(name, concept=None, personality=None, speaking_style=None, appearance=None, model=None, language=None):
    # --- 입력 컨텍스트 라인 ---
    concept_line = f"\n    Setting/Background: {concept}" if concept else ""
    personality_line = f"\n    Personality: {personality}" if personality else ""
    speaking_style_line = f"\n    Speaking Style / Speech Habits: {speaking_style}" if speaking_style else ""
    appearance_line = f"\n    Appearance: {appearance}" if appearance else ""

    # --- concept 제약 (max 700 chars) ---
    concept_constraint = (
        f"\n    - concept (max 700 characters): Use the user-provided setting/background as a base: \"{concept}\". "
        "Enrich with vivid world-building: where they live, what their daily life looks like, "
        "a key turning point or secret in their past, and what drives them now. Preserve the original core setting."
    ) if concept else (
        "\n    - concept (max 700 characters): Infer a rich setting/background from the personality and name. "
        "Include their world, daily life, a defining past event or hidden backstory, and current motivation. "
        "Make it specific — avoid generic descriptions."
    )

    # --- personality 제약 (keyword-based, max 500 chars) ---
    personality_constraint = (
        f"\n    - personality (max 500 characters, KEYWORD-BASED FORMAT): Use the user-provided traits as a base: \"{personality}\". "
        "Output as a comma-separated list of vivid keyword phrases (NOT full sentences). "
        "Example format: \"fiercely loyal, secretly insecure, obsessed with vintage records, laughs too loud, "
        "cold to strangers but melts around kids, hates being pitied, stress-eats ramen at 2am\". "
        "Include 8-12 keyword phrases covering: core values, a contradiction/vulnerability, a quirky habit, "
        "social behavior differences, emotional triggers. Preserve the original traits. "
        "Do NOT include speaking style — those go in speaking_style."
    ) if personality else (
        "\n    - personality (max 500 characters, KEYWORD-BASED FORMAT): Infer personality from the concept and name. "
        "Output as a comma-separated list of vivid keyword phrases (NOT full sentences). "
        "Example format: \"fiercely loyal, secretly insecure, obsessed with vintage records, laughs too loud, "
        "cold to strangers but melts around kids, hates being pitied, stress-eats ramen at 2am\". "
        "Include 8-12 keyword phrases covering: core values, a contradiction/vulnerability, a quirky habit, "
        "social behavior differences, emotional triggers. Avoid generic traits like 'kind' or 'friendly'. "
        "Do NOT include speaking style — those go in speaking_style."
    )

    # --- speaking_style 제약 (max 500 chars) ---
    speaking_style_constraint = (
        f"\n    - speaking_style (max 500 characters): Use the user-provided speaking style as-is: \"{speaking_style}\". "
        "You may enrich with: a signature catchphrase, filler words, how they express excitement vs. frustration, "
        "sentence length tendencies (short and blunt? long and winding?). Preserve the original."
    ) if speaking_style else (
        "\n    - speaking_style (max 500 characters): Infer concrete, distinctive speech habits. "
        "Include: a signature catchphrase or verbal tic, typical filler words, "
        "how they express excitement vs. frustration, sentence length tendency. "
        "Be specific — not 'speaks casually' but 'drops subjects, trails off with \"...ya know?\", "
        "swears when excited'."
    )

    # --- appearance 제약 (max 700 chars) ---
    appearance_spec_constraint = (
        f"\n    - appearance (max 700 characters): Use the user-provided appearance as a base: \"{appearance}\". "
        "START with an art style tag that best fits the character's vibe "
        "(e.g., 'Pixar 3D', 'anime cel-shaded', 'oil painting', 'watercolor', 'comic book', 'realistic photo', 'pixel art', 'noir ink'). "
        "Then describe the look. You may enrich with: a signature item, posture/body language, "
        "and one distinctive visual detail. Preserve the original."
    ) if appearance else (
        "\n    - appearance (max 700 characters): START with an art style tag that best fits the character's personality and concept "
        "(e.g., 'Pixar 3D', 'anime cel-shaded', 'oil painting', 'watercolor', 'comic book', 'realistic photo', 'pixel art', 'noir ink'). "
        "Then describe: body type, clothing, hair, a signature item or accessory, "
        "posture/body language, and one memorable detail (scar, tattoo, unusual eyes, etc.). "
        "Can be human, animal, robot, fantasy creature, or personified object."
    )
    appearance_image_constraint = (
        "\n    - image_prompt MUST faithfully reflect the appearance field. "
        "Prioritize those visual details over anything inferred from the concept."
    ) if appearance else (
        "\n    - image_prompt should reflect the appearance field and include concrete visual details "
        "(art style, expression, mood, color palette, lighting)."
    )

    name_empty = not name or name == "Unnamed"
    name_line = f"Name: {name}" if not name_empty else "Name: (empty — suggest a fitting name)"

    prompt = f"""
    Create a three-dimensional conversational character — someone (or something) that feels REAL, not like a template.
    The character can be a person, an animal, a robot, a mythical creature, or even an inanimate object or abstract concept given a voice.
    Think about: What shaped them? What do they want? What are they afraid of? What makes them contradictory?
    {name_line}{concept_line}{personality_line}{speaking_style_line}{appearance_line}

    Return ONLY valid JSON.
    Structure:
    {{
      "name": "...",
      "concept": "...",
      "personality": "...",
      "speaking_style": "...",
      "appearance": "...",
      "intro_script": "...",
      "image_prompt": "...",
      "gender": "male" | "female",
      "accent": "...",
      "age": "young" | "middle_aged" | "old"
    }}

    *** HARD CHARACTER LIMITS — every field MUST be strictly under the limit. Count characters carefully. ***
    - name: MUST be ≤ 50 characters
    - concept: MUST be ≤ 700 characters
    - personality: MUST be ≤ 500 characters (comma-separated keyword phrases, NOT sentences)
    - speaking_style: MUST be ≤ 500 characters
    - appearance: MUST be ≤ 700 characters
    - intro_script: MUST be ≤ 300 characters

    Constraints:
    - name (max 50 characters): {"If the user provided a name, use it EXACTLY as-is. Do NOT change, translate, or 'improve' the user's name." if not name_empty else "Suggest a creative, memorable character name that fits the concept and personality. Short and punchy — a name that sticks. Can be a real name, nickname, title, or invented word."}{concept_constraint}{personality_constraint}{speaking_style_constraint}
    {appearance_spec_constraint}
    - intro_script (STRICTLY ≤ 300 characters): A self-introduction that instantly reveals personality. NOT a generic greeting — show attitude, humor, or quirk. Must sound like THEM, not a template. End with punctuation.
    - image_prompt (25–60 words): MUST be non-empty and clearly related to the concept. Describe ONE character (portrait) — can be human, animal, robot, fantasy creature, personified object, or any being that fits the concept. The art style and visual tone MUST reflect the character's personality: e.g. dark/moody for brooding characters, bright/warm for cheerful ones, gritty for tough characters, soft/dreamy for gentle ones. Specify the art style (e.g. realistic, anime, watercolor, noir, pixel art, oil painting), expression, mood, and color palette.{appearance_image_constraint} No text/logos/watermarks.
    - gender: The character's voice gender. Must be exactly "male" or "female".
    - accent: Pick ONE from this list that best fits the character: american, british, brazilian, latin american, peninsular, indian, australian, istanbul, seoul, mexican, egyptian, german, canadian, saudi, parisian, swedish, filipino, african american. Must be one of these exact values. Do NOT use "standard".
    - age: The character's perceived voice age. Must be exactly one of: "young", "middle_aged", "old". Choose based on the character's concept, personality, and backstory.
    """

    system_msg = (
        "You are an expert character designer who creates three-dimensional, memorable characters. "
        f"{_lang_directive(language)} "
        "Every character MUST have: (1) a specific backstory with a turning point, "
        "(2) an internal contradiction or vulnerability that makes them human, "
        "(3) distinctive speech patterns that are immediately recognizable, "
        "(4) a visually striking appearance with at least one iconic detail. "
        "CRITICAL: The personality field MUST be a comma-separated list of vivid keyword phrases, "
        "NOT full sentences. Example: \"fiercely loyal, secretly insecure, obsessed with vinyl, laughs too loud\". "
        "NEVER use generic traits like 'kind', 'friendly', 'mysterious'. "
        "CRITICAL: Respect character limits per field. "
        "concept ≤ 700, personality ≤ 500, speaking_style ≤ 500, "
        "appearance ≤ 700, intro_script ≤ 300 chars. "
        "Output strictly valid JSON with no extra text."
    )

    _agent_spec_schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "concept": {"type": "string"},
            "personality": {"type": "string"},
            "speaking_style": {"type": "string"},
            "appearance": {"type": "string"},
            "intro_script": {"type": "string"},
            "image_prompt": {"type": "string"},
            "gender": {"type": "string"},
            "accent": {"type": "string"},
            "age": {"type": "string"}
        },
        "required": ["name", "concept", "personality", "speaking_style", "appearance", "intro_script", "image_prompt", "gender", "accent", "age"],
        "additionalProperties": False
    }
    response = get_anthropic_client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=system_msg,
        messages=[
            {"role": "user", "content": prompt},
        ],
        output_config={"format": {"type": "json_schema", "schema": _agent_spec_schema}},
    )

    content = _clean_llm_json(response.content[0].text if response.content else "")
    payload = json.loads(content)
    if not isinstance(payload, dict):
        raise ValueError("Agent spec must be a JSON object")

    # --- 글자수 제한 강제 적용 ---
    _FIELD_LIMITS = {
        "concept": 700,
        "personality": 700,
        "speaking_style": 500,
        "appearance": 700,
        "intro_script": 300,
    }
    for field, limit in _FIELD_LIMITS.items():
        val = (str(payload.get(field) or "")).strip()
        if len(val) > limit:
            val = val[:limit]
        payload[field] = val

    # --- accent 정규화: "standard" 사용 금지 → "american" 대체 ---
    raw_accent = (str(payload.get("accent") or "")).strip().lower()
    if raw_accent == "standard":
        payload["accent"] = "american"

    # --- age 정규화 ---
    raw_age = (str(payload.get("age") or "")).strip().lower().replace(" ", "_").replace("-", "_")
    payload["age"] = raw_age if raw_age in ("young", "middle_aged", "old") else "middle_aged"

    image_prompt = (str(payload.get("image_prompt") or "")).strip()
    image_prompt = re.sub(r"\s+", " ", image_prompt)
    if len(image_prompt) > 500:
        image_prompt = image_prompt[:497].rstrip() + "..."
    payload["image_prompt"] = image_prompt

    return payload

def _get_gemini_image_client():
    try:
        from google import genai
        return genai
    except ImportError:
        raise RuntimeError(
            "IMAGE_PROVIDER=gemini requires google-genai. Run: pip install google-genai"
        )


def _build_background_image_prompt(title, setting, situation, core_emotion, tone):
    """클립의 setting/situation/emotion에서 배경 이미지 프롬프트를 생성한다."""
    parts = []
    if setting and setting.strip():
        parts.append(setting.strip())
    if situation and situation.strip():
        parts.append(situation.strip())
    if not parts:
        if title and title.strip():
            parts.append(title.strip())
    if not parts:
        return None
    scene_desc = ". ".join(parts)
    mood = ""
    if core_emotion and core_emotion.strip():
        mood += f" Mood: {core_emotion.strip()}."
    if tone and tone.strip():
        mood += f" Tone: {tone.strip()}."
    return (
        f"Atmospheric scene background: {scene_desc}.{mood} "
        "Wide cinematic landscape or environment shot, no people, no characters, no text, no UI. "
        "Soft lighting, painterly style, suitable as a blurred background for audio content."
    )


async def _generate_background_image_async(prompt):
    """배경 이미지를 비동기로 생성한다 (asyncio.to_thread로 동기 API 호출 래핑)."""
    def _sync_generate():
        try:
            result = get_openai_client().images.generate(
                model="gpt-image-1-mini",
                prompt=prompt,
                quality="low",
                size="1024x1024",
            )
            data0 = (result.data or [None])[0]
            if data0 is None:
                return None
            b64 = getattr(data0, "b64_json", None) or (
                data0.get("b64_json") if isinstance(data0, dict) else None
            )
            if b64:
                return base64.b64decode(b64)
            url = getattr(data0, "url", None) or (data0.get("url") if isinstance(data0, dict) else None)
            if url:
                with urllib.request.urlopen(url) as resp:
                    return resp.read()
            return None
        except Exception as e:
            print(f"[background_image] generation error: {e}", flush=True)
            return None
    return await asyncio.to_thread(_sync_generate)


def generate_agent_image_png_bytes(image_prompt):
    prompt = (image_prompt or "").strip()
    if not prompt:
        raise ValueError("image_prompt is empty")
    prompt = (
        f"{prompt} "
        "Character portrait, head-and-shoulders or upper-body, centered composition, single subject. "
        "The subject may be human, animal, robot, fantasy creature, personified object, or any other character type — match the concept. "
        "Expressive face and posture that convey personality. "
        "Clean background that complements the subject. No text, no logos, no watermarks, no UI elements."
    )

    if IMAGE_PROVIDER == "midjourney":
        raise RuntimeError(
            "Midjourney image provider is not implemented yet. "
            "Set IMAGE_PROVIDER=openai or gemini to use images."
        )

    if IMAGE_PROVIDER == "gemini":
        if not GEMINI_API_KEY:
            raise RuntimeError("IMAGE_PROVIDER=gemini requires GEMINI_API_KEY or GOOGLE_API_KEY.")
        genai = _get_gemini_image_client()
        from google.genai import types

        # Nano Banana / Nano Banana Pro: gemini-2.5-flash-image, gemini-3-pro-image-preview → generate_content
        # Imagen: imagen-* → generate_images
        use_nano_banana = GEMINI_IMAGE_MODEL.strip().lower().startswith("gemini-")

        if use_nano_banana:
            client = genai.Client(api_key=GEMINI_API_KEY)
            response = client.models.generate_content(
                model=GEMINI_IMAGE_MODEL,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    image_config=types.ImageConfig(aspect_ratio="1:1", image_size="1K"),
                ),
            )
            parts = getattr(response, "parts", None) or []
            for part in parts:
                if getattr(part, "inline_data", None):
                    img = getattr(part, "as_image", lambda: None)()
                    if img is not None:
                        try:
                            from io import BytesIO
                            buf = BytesIO()
                            img.save(buf, format="PNG")
                            return buf.getvalue()
                        except Exception:
                            pass
                    data = getattr(part.inline_data, "data", None)
                    if data:
                        return base64.b64decode(data) if isinstance(data, str) else data
            raise RuntimeError("Nano Banana image generator returned no image in response")
        else:
            client = genai.Client(api_key=GEMINI_API_KEY)
            response = client.models.generate_images(
                model=GEMINI_IMAGE_MODEL,
                prompt=prompt,
                config=types.GenerateImagesConfig(
                    number_of_images=1,
                    aspect_ratio="1:1",
                    person_generation="allow_adult",
                ),
            )
            if not response.generated_images:
                raise RuntimeError("Gemini image generator returned no images")
            img_obj = response.generated_images[0].image
            raw = getattr(img_obj, "image_bytes", None)
            if raw is not None:
                return base64.b64decode(raw) if isinstance(raw, str) else raw
            try:
                from io import BytesIO
                buf = BytesIO()
                img_obj.save(buf, format="PNG")
                return buf.getvalue()
            except Exception:
                pass
            raise RuntimeError("Could not get PNG bytes from Gemini generated image")

    if IMAGE_PROVIDER != "openai":
        raise RuntimeError(f"Unknown IMAGE_PROVIDER: {IMAGE_PROVIDER}")

    result = get_openai_client().images.generate(
        model="gpt-image-1-mini",
        prompt=prompt,
        size="1024x1024",
    )

    data0 = (result.data or [None])[0]
    if data0 is None:
        raise RuntimeError("Image generator returned empty data")

    b64 = getattr(data0, "b64_json", None) or (
        data0.get("b64_json") if isinstance(data0, dict) else None
    )
    if b64:
        return base64.b64decode(b64)

    url = getattr(data0, "url", None) or (data0.get("url") if isinstance(data0, dict) else None)
    if not url:
        raise RuntimeError("Image generator returned no image data")

    with urllib.request.urlopen(url) as response:
        return response.read()

def _select_voice_from_candidates(spec, candidates, gender, accent, age=None, already_used=None):
    """gender/accent/age로 보이스 후보를 필터링한 뒤 LLM이 최적의 보이스를 선택한다. already_used가 있으면 해당 voice_id는 제외(다양화)."""
    import random as _rand

    already_set = set((already_used or []) or [])

    # 1) gender 필터
    filtered = [v for v in candidates if (v.get("gender") or "").lower() == gender] if gender else candidates
    if len(filtered) < 5:
        filtered = list(candidates)  # 매칭 부족하면 전체 유지

    # 2) accent 소프트 필터 (후보 3개 초과일 때 적용)
    if accent and len(filtered) > 3:
        accent_match = [v for v in filtered if (v.get("accent") or "").lower() == accent]
        if len(accent_match) >= 2:
            filtered = accent_match

    # 3) age 소프트 필터 (후보 3개 초과일 때 적용)
    if age and len(filtered) > 3:
        age_match = [v for v in filtered if (v.get("age") or "").lower().replace(" ", "_").replace("-", "_") == age]
        if len(age_match) >= 2:
            filtered = age_match

    # 4) 이미 사용된 voice 제외 (다양화: 같은 시리즈 내 다른 에이전트와 다른 목소리)
    if already_set:
        filtered = [v for v in filtered if v.get("id") not in already_set]
        if len(filtered) < 3:
            # 제외 후 후보가 너무 적으면 원본 후보에서 이미 사용 제외만 적용
            filtered = [v for v in candidates if v.get("id") not in already_set]
        filtered = filtered[:30]
    else:
        filtered = filtered[:30]

    print(f"[produce_agent] Voice candidates: {len(candidates)} total → {len(filtered)} after filter (gender={gender}, accent={accent}, age={age}, exclude_used={len(already_set)})")

    # 4) LLM으로 최종 선택
    voice_list = "\n".join(
        f"{v['id']}: {v['name']}, {v.get('gender','')}, {v.get('age','')}, {v.get('accent','')} - {(v.get('desc') or '')[:40]}"
        for v in filtered
    )

    char_info = []
    if spec.get("personality"):
        char_info.append(f"Personality: {spec['personality'][:200]}")
    if spec.get("speaking_style"):
        char_info.append(f"Speaking style: {spec['speaking_style'][:100]}")
    if gender:
        char_info.append(f"Gender: {gender}")
    if age:
        char_info.append(f"Age: {age}")
    if accent:
        char_info.append(f"Accent: {accent}")

    valid_ids = {v["id"] for v in filtered}
    avoid_note = ""
    if already_set:
        avoid_note = "\n\nImportant: The following voice IDs are already assigned to other characters in this series. You MUST choose a different voice from the list above."
    messages = [
        {"role": "system", "content": (
            "You are a voice casting director. Select the best matching voice for this character. "
            "You MUST prioritize matching the character's accent and age above all else. "
            "Only consider vocal quality as a tiebreaker between otherwise equally matching voices. "
            "Reply with ONLY the voice_id. No explanation."
        )},
        {"role": "user", "content": f"Character:\n{chr(10).join(char_info)}\n\nVoices:\n{voice_list}{avoid_note}"},
    ]

    for attempt in range(3):
        try:
            completion = get_openai_client().chat.completions.create(
                model="gpt-5-mini",
                messages=messages,
                max_completion_tokens=2000,
            )
            if not completion.choices:
                raise ValueError("Empty choices from LLM")
            raw = (completion.choices[0].message.content or "").strip()
            if not raw:
                raise ValueError("Empty content from LLM")
            voice_id = raw.split()[0].strip().strip('"\'')

            if voice_id in valid_ids:
                print(f"[produce_agent] Voice selected by LLM: {voice_id}")
                return voice_id
            for vid in valid_ids:
                if vid in raw:
                    print(f"[produce_agent] Voice found in LLM response: {vid}")
                    return vid
            print(f"[produce_agent] LLM returned unrecognized voice_id (attempt {attempt+1}): {raw[:100]}")
        except Exception as e:
            print(f"[produce_agent] Voice LLM attempt {attempt+1}/3 failed: {e}")

    # 폴백: 필터된 후보 중 랜덤
    if not filtered:
        filtered = [v for v in candidates if v.get("id") not in already_set] if already_set else list(candidates)
    if not filtered:
        filtered = list(candidates)
    fallback = _rand.choice(filtered)
    print(f"[produce_agent] Voice auto-selected (random): {fallback['id']} ({fallback['name']})")
    return fallback["id"]


async def produce_agent(name, concept=None, personality=None, default_voice="en-US-ChristopherNeural", intro_line=None, elevenlabs_voice_id=None, speaking_style=None, appearance=None, voice_candidates=None, pre_spec=None, already_used_voice_ids=None, language=None):
    agent_id = allocate_agent_id(name)

    if pre_spec and isinstance(pre_spec, dict) and pre_spec.get("personality"):
        print(f"[produce_agent] Using pre-generated spec from AI Assist (skipping generate_agent_spec)")
        spec = pre_spec
    else:
        spec = generate_agent_spec(name, concept=concept, personality=personality, speaking_style=speaking_style, appearance=appearance, language=language)
    gen_concept = (spec.get("concept") or "").strip()
    gen_personality = (spec.get("personality") or "").strip()
    gen_speaking_style = (spec.get("speaking_style") or "").strip()
    gen_appearance = (spec.get("appearance") or "").strip()
    gender = (spec.get("gender") or "").strip().lower()
    accent = (spec.get("accent") or "").strip().lower()
    age = (spec.get("age") or "").strip().lower()
    # 사용자가 인사말을 지정했으면 그것을 사용, 아니면 LLM 생성 결과 사용
    if intro_line and intro_line.strip():
        intro_script = _ensure_sentence_end(intro_line.strip())
    else:
        intro_script = _ensure_sentence_end(spec.get("intro_script") or "")
    image_prompt = (spec.get("image_prompt") or "").strip()

    if not (gen_concept or gen_personality) or not intro_script:
        raise RuntimeError("Agent generator returned empty fields")

    if not image_prompt:
        concept_for_img = gen_concept or concept or ""
        app_note = f" Appearance: {appearance}." if appearance else ""
        image_prompt = f"Expressive character portrait of {name}. {concept_for_img}.{app_note} Rich lighting, clean background.".strip()

    # 음성 선택: voice_id가 없고 voice_candidates가 있으면 자동 선택 (이미 사용된 voice는 제외)
    if not elevenlabs_voice_id and voice_candidates:
        elevenlabs_voice_id = _select_voice_from_candidates(spec, voice_candidates, gender, accent, age, already_used_voice_ids)

    # TTS: 메모리에서 bytes로 생성 (로컬 파일 저장 없음)
    voice_for_tts = elevenlabs_voice_id if elevenlabs_voice_id else default_voice
    intro_bytes = await generate_audio_line_bytes(intro_script, voice_for_tts, "+0%", "+0Hz")
    intro_seconds = get_audio_duration_from_bytes(intro_bytes)
    if intro_seconds >= 30.0:
        raise RuntimeError("Generated intro mp3 is not under 30 seconds")

    # 아바타 이미지: 메모리에서 bytes로 생성 (로컬 파일 저장 없음, 503 등 일시 오류 재시도)
    png_bytes = None
    if image_prompt:
        prompts_to_try = [
            image_prompt,
            f"Expressive character portrait of {name}. {gen_concept or concept or ''}. Rich lighting, clean background.",
        ]
        for img_prompt in prompts_to_try:
            for attempt in range(3):
                try:
                    png_bytes = generate_agent_image_png_bytes(img_prompt)
                    break
                except Exception as e:
                    err_str = str(e)
                    is_transient = any(k in err_str for k in ["503", "UNAVAILABLE", "429", "overloaded", "high demand"])
                    if is_transient and attempt < 2:
                        print(f"[produce_agent] Image gen attempt {attempt+1}/3 transient error, retrying in {2 ** (attempt+1)}s: {err_str[:120]}")
                        time.sleep(2 ** (attempt + 1))
                    elif attempt == 2:
                        print(f"[produce_agent] Image gen failed after 3 attempts: {err_str[:120]}")
                    else:
                        break  # 비일시적 오류면 다음 프롬프트로
            if png_bytes:
                break

    agent_payload = {
        "id": agent_id,
        "name": name,
        "concept": gen_concept or (concept or ""),
        "voice": default_voice,
        "rate": "+0%",
        "pitch": "+0Hz",
        "personality": gen_personality or (personality or ""),
        "speaking_style": gen_speaking_style or (speaking_style or ""),
        "appearance": gen_appearance or (appearance or ""),
        "intro_script": intro_script,
        "intro_seconds": round(float(intro_seconds), 2),
        "image_prompt": image_prompt,
        "image_bytes": png_bytes,
        "intro_mp3_bytes": intro_bytes,
        "gender": gender,
        "accent": accent,
    }
    if elevenlabs_voice_id:
        agent_payload["elevenlabs_voice_id"] = elevenlabs_voice_id

    return agent_payload

def combine_audio_ffmpeg(file_list, output_filename):
    """FFmpeg으로 오디오 파일들을 안정적으로 하나의 mp3로 합친다.

    NOTE:
    - SFX 소스(예: ElevenLabs SFX)는 코덱/샘플레이트가 다를 수 있어 `-c copy`에서
      중간 깨짐/끊김이 발생할 수 있다.
    - 항상 재인코딩하여 출력 포맷을 통일한다.
    """
    list_txt = "file_list.txt"
    
    # FFmpeg concat 리스트 생성
    with open(list_txt, "w", encoding="utf-8") as f:
        for filename in file_list:
            safe_filename = filename.replace("\\", "/")
            f.write(f"file '{safe_filename}'\n")

    # FFmpeg 실행 (재인코딩으로 포맷 통일)
    cmd = [
        _FFMPEG_CMD, "-y", "-f", "concat", "-safe", "0",
        "-i", list_txt,
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        "-ar", "44100",
        "-ac", "2",
        output_filename,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {result.stderr.strip()}")

    # 리스트 파일 삭제
    if os.path.exists(list_txt):
        os.remove(list_txt)

def export_clip_shorts(
    mp3_path: str,
    json_path: str,
    output_mp4: str,
    agents_map: dict,
    avatar_paths: dict | None = None,
    width: int = 1080,
    height: int = 1920,
    no_watermark: bool = False,
    bg_image_path: str | None = None,
):
    """
    클립 MP3 + 타이밍 JSON + 에이전트 아바타로 1080x1920 세로 MP4(숏츠) 생성.
    모든 파일은 이미 로컬에 다운로드된 상태여야 함.
    mp3_path: 클립 오디오 파일 경로
    json_path: 타이밍 JSON 파일 경로
    output_mp4: 출력 MP4 파일 경로
    avatar_paths: {agent_id: "/absolute/path/to/avatar.png", ...} (없으면 placeholder 생성)
    반환: 생성된 MP4 파일 절대 경로
    """
    if not os.path.isfile(mp3_path):
        raise FileNotFoundError(f"MP3 not found: {mp3_path}")
    if not os.path.isfile(json_path):
        raise FileNotFoundError(f"Timing JSON not found: {json_path}")

    with open(json_path, "r", encoding="utf-8") as f:
        timing_data = json.load(f)
    # transcript JSON이 {"lines": [...]} 형태일 수 있음
    if isinstance(timing_data, dict):
        timing_lines = timing_data.get("lines") or timing_data.get("transcript") or []
    elif isinstance(timing_data, list):
        timing_lines = timing_data
    else:
        timing_lines = []

    # 등장 에이전트 id 추출 (순서 유지, sfx/narration 제외)
    speaker_ids = []
    seen = set()
    for line in timing_lines:
        sid = line.get("speaker", "")
        if sid and sid not in ("sfx", "narration") and sid not in seen:
            speaker_ids.append(sid)
            seen.add(sid)

    # 아바타 경로 검증
    if avatar_paths is None:
        avatar_paths = {}
    for sid in speaker_ids:
        if sid not in avatar_paths or not os.path.isfile(avatar_paths.get(sid, "")):
            avatar_paths[sid] = None  # placeholder 사용

    # 에이전트 이름 매핑
    agent_names = {}
    for sid in speaker_ids:
        if sid in agents_map:
            agent_names[sid] = agents_map[sid].get("name", sid)
        else:
            agent_names[sid] = sid

    # 출력 디렉토리 확보
    out_dir = os.path.dirname(output_mp4)
    os.makedirs(out_dir, exist_ok=True)

    # placeholder 아바타 생성 (단색 원)
    placeholder_dir = os.path.join(out_dir, "_placeholders")
    os.makedirs(placeholder_dir, exist_ok=True)
    for sid in speaker_ids:
        if not avatar_paths.get(sid):
            ph_path = os.path.join(placeholder_dir, f"{sid}.png")
            _generate_placeholder_avatar(ph_path, agent_names.get(sid, "?"), width=400, height=400)
            avatar_paths[sid] = ph_path

    # 각 화자의 dominant color (Supabase agents 테이블에서 전달받음)
    # 어두운 색은 검정 배경에서 안 보이므로 최소 밝기 보장
    def _ensure_brightness(r, g, b, min_lum=160):
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        if lum >= min_lum:
            return (r, g, b)
        if lum < 1:
            return (min_lum, min_lum, min_lum)
        scale = min_lum / lum
        return (
            min(255, int(r * scale)),
            min(255, int(g * scale)),
            min(255, int(b * scale)),
        )

    speaker_colors = {}
    for sid in speaker_ids:
        raw = agents_map.get(sid, {}).get("dominant_color") if isinstance(agents_map.get(sid), dict) else None
        if raw and isinstance(raw, str):
            parts = [int(v.strip()) for v in raw.split(",") if v.strip().isdigit()]
            if len(parts) >= 3:
                speaker_colors[sid] = _ensure_brightness(parts[0], parts[1], parts[2])
                continue
        speaker_colors[sid] = (164, 244, 207)  # 기본 민트색 fallback

    # ASS 자막 파일 생성 (화자별 색상 적용)
    ass_path = output_mp4 + ".ass"
    _generate_ass_subtitle(timing_lines, agent_names, ass_path, width, height, speaker_colors)

    # FFmpeg 렌더링
    _render_shorts_ffmpeg(
        mp3_path=mp3_path,
        ass_path=ass_path,
        avatar_paths=avatar_paths,
        speaker_ids=speaker_ids,
        agent_names=agent_names,
        timing_lines=timing_lines,
        output_mp4=output_mp4,
        width=width,
        height=height,
        no_watermark=no_watermark,
        speaker_colors=speaker_colors,
        bg_image_path=bg_image_path,
    )

    return os.path.abspath(output_mp4)


def _generate_placeholder_avatar(path: str, name: str, width: int = 400, height: int = 400):
    """FFmpeg로 단색 배경 + 이니셜 텍스트 placeholder 아바타 생성."""
    initial = (name[0] if name else "?").upper()
    # FFmpeg drawtext 필터 특수문자 이스케이프: ' : \ [ ]
    safe_initial = initial.replace("\\", "\\\\\\\\").replace("'", "'\\\\\\''").replace(":", "\\\\:").replace("[", "\\[").replace("]", "\\]")
    font_spec = f"fontfile='{_ffp(NOTO_SANS_PATH)}'" if NOTO_SANS_PATH else "font='Noto Sans KR'"
    cmd = [
        _FFMPEG_CMD, "-y", "-f", "lavfi",
        "-i", f"color=c=0x2ECC71:s={width}x{height}:d=1",
        "-vf", f"drawtext=text='{safe_initial}':{font_spec}:fontsize={width//2}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",
        "-frames:v", "1",
        path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        print(f"[placeholder] FFmpeg error: {(result.stderr or '')[-500:]}")


def _generate_ass_subtitle(timing_lines, agent_names, ass_path, width, height, speaker_colors=None):
    """타이밍 데이터로 ASS 자막 파일 생성. 화자별 dominant color 및 이름 표시."""
    if speaker_colors is None:
        speaker_colors = {}

    # RGB → ASS &H00BBGGRR 변환
    def _rgb_to_ass(r, g, b):
        return f"&H00{b:02X}{g:02X}{r:02X}"

    # ASS 시간 포맷: H:MM:SS.CC
    def _fmt(sec):
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = sec % 60
        return f"{h}:{m:02d}:{s:05.2f}"

    font_size = 90
    margin_v = int(height * 0.32)  # 화면 하단 쪽에 자막 배치

    # 화자별 안전한 스타일 이름 매핑
    style_names = {}
    for i, (sid, color) in enumerate(speaker_colors.items()):
        style_names[sid] = f"S{i}"

    lines = []
    lines.append("[Script Info]")
    lines.append(f"PlayResX: {width}")
    lines.append(f"PlayResY: {height}")
    lines.append("ScriptType: v4.00+")
    lines.append("")
    lines.append("[V4+ Styles]")
    lines.append("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding")

    # 화자별 스타일 생성 (dominant color, 아웃라인 없음)
    for sid, sname in style_names.items():
        r, g, b = speaker_colors.get(sid, (164, 244, 207))
        ass_color = _rgb_to_ass(r, g, b)
        lines.append(
            f"Style: {sname},Noto Sans KR,{font_size},{ass_color},&H000000FF,&H00000000,&H80000000,"
            f"-1,0,0,0,100,100,0,0,1,2,1,2,40,40,{margin_v},1"
        )

    # 기본 스타일 (fallback)
    lines.append(
        f"Style: Default,Noto Sans KR,{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,2,1,2,40,40,{margin_v},1"
    )
    lines.append("")
    lines.append("[Events]")
    lines.append("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")

    prev_speaker = None
    for tl in timing_lines:
        speaker = tl.get("speaker", "")
        start = tl.get("start", 0)
        end = tl.get("end", 0)
        text = tl.get("text", "")

        # SFX 라인은 자막에 표시하지 않음
        if speaker == "sfx":
            prev_speaker = None
            continue

        # 나레이션은 이름 없이 텍스트만 표시
        if speaker == "narration":
            sub_text = text
            prev_speaker = speaker
            style = "Default"
            lines.append(
                f"Dialogue: 1,{_fmt(start)},{_fmt(end)},{style},,0,0,0,,{sub_text}"
            )
            continue

        # 화자별 스타일 선택
        style = style_names.get(speaker, "Default")

        # 화자 이름은 화자가 바뀔 때만 표시
        if speaker != prev_speaker:
            name = agent_names.get(speaker, speaker)
            name_size = int(font_size * 0.7)
            sub_text = f"{{\\fs{name_size}}}{name}\\N{{\\fs{font_size}}}{text}"
        else:
            sub_text = text
        prev_speaker = speaker
        lines.append(
            f"Dialogue: 1,{_fmt(start)},{_fmt(end)},{style},,0,0,0,,{sub_text}"
        )

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def _generate_logo_png(output_dir: str) -> str:
    """KIRICAST 로고를 사이트와 동일한 민트 그라데이션으로 렌더링하여 PNG로 저장."""
    text = "KIRICAST"
    font_size = 36

    try:
        font = ImageFont.truetype(POPPINS_PATH, font_size) if POPPINS_PATH else ImageFont.load_default()
    except OSError:
        font = ImageFont.load_default()

    # 텍스트 크기 측정
    dummy = Image.new("RGBA", (1, 1))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = 4
    w, h = tw + pad * 2, th + pad * 2

    # 135° 그라데이션 (#A4F4CF → #7CEDA3) 이미지 생성
    c1 = (164, 244, 207)  # #A4F4CF
    c2 = (124, 237, 163)  # #7CEDA3
    gradient = Image.new("RGBA", (w, h))
    diag = w + h
    for x in range(w):
        for y in range(h):
            t = (x + y) / diag if diag else 0
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            gradient.putpixel((x, y), (r, g, b, 255))

    # 텍스트를 알파 마스크로 렌더링
    mask = Image.new("L", (w, h), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.text((pad - bbox[0], pad - bbox[1]), text, font=font, fill=255)

    # 그라데이션 + 마스크 합성 (투명 배경)
    result = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    result = Image.composite(gradient, result, mask)

    logo_path = os.path.join(output_dir, "kiricast_logo.png")
    result.save(logo_path)
    return logo_path


def _round_avatar(src_path: str, output_path: str, radius_ratio: float = 0.15) -> str:
    """아바타 이미지에 둥근 모서리를 적용하여 PNG로 저장."""
    img = Image.open(src_path).convert("RGBA")
    w, h = img.size
    radius = int(min(w, h) * radius_ratio)
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, w, h], radius=radius, fill=255)
    result = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    result.paste(img, mask=mask)
    result.save(output_path)
    return output_path


def _render_shorts_ffmpeg(
    mp3_path, ass_path, avatar_paths, speaker_ids, agent_names,
    timing_lines, output_mp4, width, height,
    no_watermark=False,
    speaker_colors=None,
    bg_image_path=None,
):
    """
    FFmpeg로 숏츠 영상 렌더링.
    레이아웃: 두 에이전트 아바타를 나란히 배치, 말하는 에이전트는 위아래 흔들림,
    안 말하는 에이전트는 어둡게 처리. 하단에 ASS 자막.
    """
    duration = 0
    for tl in timing_lines:
        e = tl.get("end", 0)
        if e > duration:
            duration = e
    duration = max(duration, 1)

    # 입력: 배경 + 오디오 + 아바타 이미지들
    inputs = []
    input_idx = 0
    use_bg_image = bg_image_path and os.path.isfile(bg_image_path)

    if use_bg_image:
        # [0] 배경 이미지
        inputs.extend(["-loop", "1", "-i", bg_image_path])
    else:
        # [0] 단색 검정 배경
        inputs.extend(["-f", "lavfi", "-i",
            f"color=c=black:s={width}x{height}:d={duration}:r=30"])
    bg_idx = input_idx
    input_idx += 1

    # [1] 오디오
    inputs.extend(["-i", mp3_path])
    audio_idx = input_idx
    input_idx += 1

    # [2..N] 아바타 이미지 (둥근 모서리 적용)
    tmp_dir = os.path.dirname(output_mp4) or "."
    avatar_input_map = {}
    for sid in speaker_ids:
        ap = avatar_paths.get(sid)
        if ap and os.path.isfile(ap):
            rounded_path = os.path.join(tmp_dir, f"rounded_{sid}.png")
            _round_avatar(ap, rounded_path)
            inputs.extend(["-i", rounded_path])
            avatar_input_map[sid] = input_idx
            input_idx += 1

    # 로고 PNG 입력 (그라데이션 텍스트)
    logo_idx = None
    if not no_watermark:
        logo_path = _generate_logo_png(os.path.dirname(output_mp4) or ".")
        inputs.extend(["-i", logo_path])
        logo_idx = input_idx
        input_idx += 1

    # 복합 필터 구성
    filter_parts = []

    # 두 에이전트 나란히 배치 레이아웃 계산
    num_speakers = len(speaker_ids)
    avatar_size = int(width * 0.40) if num_speakers >= 2 else int(width * 0.55)
    gap = int(width * 0.06)
    total_w = avatar_size * num_speakers + gap * (num_speakers - 1) if num_speakers > 1 else avatar_size
    start_x = (width - total_w) // 2
    avatar_y_base = int(height * 0.18)
    bounce_amp = 4  # 흔들림 진폭 (px)
    bounce_freq = 2  # 흔들림 주파수 (Hz)

    # 각 화자의 speaking enable 표현식 미리 계산
    speaking_exprs = {}
    for sid in speaker_ids:
        parts = []
        for tl in timing_lines:
            if tl.get("speaker") == sid:
                s = tl.get("start", 0)
                e = tl.get("end", 0)
                parts.append(f"between(t,{s:.2f},{e:.2f})")
        speaking_exprs[sid] = "+".join(parts) if parts else "0"

    # 아바타 크기 조정: 밝은 버전(active)과 어두운 버전(inactive) 생성
    active_labels = {}
    dark_labels = {}
    for sid, idx in avatar_input_map.items():
        safe = sid.replace('-', '_')[:12]
        # 밝은(active) 버전
        active_lbl = f"av_{safe}"
        filter_parts.append(
            f"[{idx}:v]scale={avatar_size}:{avatar_size}:force_original_aspect_ratio=decrease,"
            f"pad={avatar_size}:{avatar_size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,"
            f"format=rgba[{active_lbl}]"
        )
        active_labels[sid] = active_lbl

        # 어두운(inactive) 버전 — brightness를 -0.3 낮춤
        dark_lbl = f"dk_{safe}"
        filter_parts.append(
            f"[{idx}:v]scale={avatar_size}:{avatar_size}:force_original_aspect_ratio=decrease,"
            f"pad={avatar_size}:{avatar_size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,"
            f"format=rgba,eq=brightness=-0.3:saturation=0.6[{dark_lbl}]"
        )
        dark_labels[sid] = dark_lbl

    # 배경 처리: 이미지가 있으면 blur + scale + dark overlay 적용
    if use_bg_image:
        # scale to cover + blur + dark overlay (ClipSlide.tsx와 동일: blur-[2px], bg-black/10)
        filter_parts.append(
            f"[{bg_idx}:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},gblur=sigma=2,"
            f"drawbox=x=0:y=0:w={width}:h={height}:color=black@0.10:t=fill,"
            f"format=yuv420p[bg_ready]"
        )
        current_stream = "[bg_ready]"
    else:
        current_stream = f"[{bg_idx}:v]"
    overlay_count = 0

    for i, sid in enumerate(speaker_ids):
        if sid not in active_labels:
            continue

        x_pos = start_x + i * (avatar_size + gap)
        speak_expr = speaking_exprs.get(sid, "0")

        # 어두운 버전 오버레이 (안 말할 때): enable = NOT speaking
        out_label = f"ov{overlay_count}"
        filter_parts.append(
            f"{current_stream}[{dark_labels[sid]}]overlay=x={x_pos}:y={avatar_y_base}"
            f":enable='not({speak_expr})'[{out_label}]"
        )
        current_stream = f"[{out_label}]"
        overlay_count += 1

        # 밝은 버전 오버레이 (말할 때): y에 bounce 적용
        bounce_y = f"{avatar_y_base}+{bounce_amp}*sin({bounce_freq}*2*PI*t)"
        out_label = f"ov{overlay_count}"
        filter_parts.append(
            f"{current_stream}[{active_labels[sid]}]overlay=x={x_pos}:y='{bounce_y}'"
            f":enable='{speak_expr}'[{out_label}]"
        )
        current_stream = f"[{out_label}]"
        overlay_count += 1

    # 화자 이름 텍스트 (각 아바타 아래, dominant color + 흰색 아웃라인)
    sc = speaker_colors or {}
    name_y = avatar_y_base + avatar_size + 36
    for i, sid in enumerate(speaker_ids):
        name = agent_names.get(sid, sid)
        x_center = start_x + i * (avatar_size + gap) + avatar_size // 2
        safe_name = name.replace("'", "'\\''").replace(":", "\\:")
        r, g, b = sc.get(sid, (164, 244, 207))
        hex_color = f"0x{r:02x}{g:02x}{b:02x}"
        out_label = f"ov{overlay_count}"
        nf_bold = f"fontfile='{_ffp(NOTO_SANS_BOLD_PATH)}'" if NOTO_SANS_BOLD_PATH else (f"fontfile='{_ffp(NOTO_SANS_PATH)}'" if NOTO_SANS_PATH else "font='Noto Sans KR'")
        filter_parts.append(
            f"{current_stream}drawtext=text='{safe_name}':{nf_bold}:fontsize=40:"
            f"fontcolor={hex_color}:"
            f"x={x_center}-text_w/2:y={name_y}[{out_label}]"
        )
        current_stream = f"[{out_label}]"
        overlay_count += 1

    # Kiricast 워터마크 (하단 중앙, 사이트 로고와 동일한 그라데이션) — Pro 이상은 제거
    if not no_watermark and logo_idx is not None:
        watermark_y = height - 70
        out_label = f"ov{overlay_count}"
        filter_parts.append(
            f"{current_stream}[{logo_idx}:v]overlay=x=(W-w)/2:y={watermark_y}[{out_label}]"
        )
        current_stream = f"[{out_label}]"
        overlay_count += 1

    # ASS 자막 오버레이 (fontsdir로 폰트 경로 보장)
    safe_ass = ass_path.replace("\\", "/").replace(":", "\\:")
    fonts_dir_opt = ""
    if NOTO_SANS_PATH:
        fd = os.path.dirname(NOTO_SANS_PATH).replace(":", "\\:")
        fonts_dir_opt = f":fontsdir='{fd}'"
    out_label = "vout"
    filter_parts.append(
        f"{current_stream}ass='{safe_ass}'{fonts_dir_opt}[{out_label}]"
    )

    filter_complex = ";".join(filter_parts)

    # 스레드 수 제한: 메모리 부족(OOM) 시 -9로 죽는 것 방지 (libx264 기본값이 CPU 코어 수라 60 등으로 커질 수 있음)
    ffmpeg_threads = int(os.environ.get("FFMPEG_X264_THREADS", "4"))
    ffmpeg_threads = max(1, min(ffmpeg_threads, 16))

    cmd = [
        _FFMPEG_CMD, "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", f"[{out_label}]",
        "-map", f"{audio_idx}:a",
        "-c:v", "libx264", "-threads", str(ffmpeg_threads), "-preset", "medium", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k",
        "-pix_fmt", "yuv420p",
        "-shortest",
        "-movflags", "+faststart",
        output_mp4,
    ]

    print(f"[shorts] Rendering {output_mp4} ... (x264 threads={ffmpeg_threads})")
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        err_msg = (result.stderr or "")[-3000:]
        print(f"[shorts] FFmpeg FAILED (code {result.returncode}):\n{err_msg}")
        if result.returncode == -9:
            raise RuntimeError(
                "Export failed: the process ran out of memory (OOM). "
                "Try a shorter clip or contact support. Server may need more RAM."
            )
        raise RuntimeError(f"FFmpeg failed (code {result.returncode}): {err_msg}")
    print(f"[shorts] Done: {output_mp4}")