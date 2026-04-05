-- migration-029-cleanup-source-unknown.sql
-- source='session:unknown' 잔여 파편 정리 (이전 코드에서 sessionId가 null일 때 설정됨)
-- 작성자: 최진호
-- 작성일: 2026-04-05

UPDATE agent_memory.fragments
   SET source = NULL
 WHERE source = 'session:unknown';
