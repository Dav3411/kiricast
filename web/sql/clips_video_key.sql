-- clips 테이블에 video_key 컬럼 추가 (숏츠 MP4 R2 키)
ALTER TABLE clips ADD COLUMN IF NOT EXISTS video_key text;
