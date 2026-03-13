---
title: "Claude Code Configuration"
date: 2026-03-13
author: 최진호
updated: 2026-03-13
---

# Claude Code Configuration

이 문서는 Claude Code에서 Memento MCP를 memory 서버로 등록하는 방법을 설명한다.

- memento 서버만 직접 실행할 경우: 이 설정은 필요 없다.
- Claude Code가 `remember`, `recall`, `context` 같은 도구를 직접 쓰게 하려면: MCP 서버 등록이 필요하다.

## 설정 파일 위치

- Windows: `%USERPROFILE%\.claude\settings.json`
- Linux / macOS: `~/.claude/settings.json`
- 프로젝트 단위: `.claude/settings.json`

## 기본 MCP 등록 예시

```json
{
  "mcpServers": {
    "memento": {
      "type": "http",
      "url": "http://localhost:57332/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MEMENTO_ACCESS_KEY"
      }
    }
  }
}
```

## 언제 필요한가

- 필요함: Claude Code가 장기 기억 서버로 memento를 사용해야 할 때
- 필요 없음: 서버만 수동 테스트하거나 다른 MCP 클라이언트만 사용할 때

## 세션 시작 시 context 자동 로드

자동 로드는 선택 사항이다. 세션 시작마다 핵심 기억을 불러오고 싶을 때만 사용한다.

### curl 기반 예시

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://localhost:57332/mcp -H 'Authorization: Bearer YOUR_KEY' -H 'Content-Type: application/json' -H 'mcp-session-id: ${MCP_SESSION_ID}' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"context\",\"arguments\":{}}}'"
          }
        ]
      }
    ]
  }
}
```

### Windows PowerShell 요청 예시

아래 예시는 설정 파일 JSON이 아니라, PowerShell에서 직접 동작 확인할 때 쓰는 예시다.

```powershell
$headers = @{
  Authorization   = "Bearer $env:MEMENTO_ACCESS_KEY"
  "Content-Type"  = "application/json"
  "mcp-session-id" = "test-session"
}

$body = @{
  jsonrpc = "2.0"
  id      = 1
  method  = "tools/call"
  params  = @{
    name      = "context"
    arguments = @{}
  }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri "http://localhost:57332/mcp" -Headers $headers -Body $body
```

## 프로젝트 단위 vs 글로벌 설정

- 글로벌 설정: 여러 프로젝트에서 공통으로 같은 memento 서버를 사용할 때 적합
- 프로젝트 설정: 저장소마다 다른 memento 서버나 다른 access key를 써야 할 때 적합

## 권장 사항

- access key는 가능한 한 환경 변수나 안전한 비밀 저장소로 관리한다.
- 서버 설치와 Claude Code 연동은 별도 단계로 이해한다.
- 세션 자동화 전에 먼저 수동 `context` 호출이 정상 동작하는지 확인한다.
