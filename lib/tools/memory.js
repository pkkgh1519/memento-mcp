/**
 * 도구: 에이전트 기억 관리 (Fragment-Based Memory)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-03-29
 *
 * MCP 도구 핸들러
 * remember, recall, forget, link, amend, reflect, context, memory_stats, memory_consolidate, graph_explore, fragment_history
 */

import { MemoryManager }    from "../memory/MemoryManager.js";
import { logAudit }         from "../utils.js";
import { logWarn }          from "../logger.js";
import { SessionActivityTracker } from "../memory/SessionActivityTracker.js";
import { getSearchMetrics } from "../memory/SearchMetrics.js";
import { getSearchObservability } from "../memory/SearchEventAnalyzer.js";
import { computeConfidence } from "../memory/UtilityBaseline.js";
import { fetchLinkedFragments } from "../memory/LinkedFragmentLoader.js";

/** 스키마 re-export (기존 import 호환) */
export {
  rememberDefinition,
  batchRememberDefinition,
  recallDefinition,
  forgetDefinition,
  linkDefinition,
  amendDefinition,
  reflectDefinition,
  contextDefinition,
  toolFeedbackDefinition,
  memoryStatsDefinition,
  memoryConsolidateDefinition,
  graphExploreDefinition,
  fragmentHistoryDefinition
} from "./memory-schemas.js";

/** ==================== 도구 핸들러 ==================== */

export async function tool_remember(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.remember(args);
    await logAudit("remember", {
      topic     : args.topic,
      type      : args.type,
      fragmentId: result.id,
      success   : true
    });
    SessionActivityTracker.record(sessionId, {
      tool: "remember", keywords: args.keywords, fragmentId: result.id
    }).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    await logAudit("remember", {
      topic  : args.topic,
      type   : args.type,
      success: false,
      details: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_batchRemember(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.batchRemember(args);
    await logAudit("batch_remember", {
      total    : args.fragments?.length || 0,
      inserted : result.inserted,
      skipped  : result.skipped,
      success  : true
    });
    SessionActivityTracker.record(sessionId, {
      tool: "batch_remember", inserted: result.inserted
    }).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    await logAudit("batch_remember", {
      total  : args.fragments?.length || 0,
      success: false,
      details: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_recall(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  if (sessionId && !args.sessionId) args.sessionId = sessionId;
  try {
    /**
     * asOf → anchorTime 변환: 일반 recall 경로로 통합.
     * 과거 시점 기준 복합 랭킹이 해당 시점 근접 파편을 우선 배치한다.
     */
    if (args.asOf) {
      const asOfDate = new Date(args.asOf);
      if (isNaN(asOfDate.getTime())) {
        return { success: false, error: `Invalid asOf: "${args.asOf}"` };
      }
      args.anchorTime = asOfDate.getTime();
      delete args.asOf;
    }

    const result = await mgr.recall(args);
    SessionActivityTracker.record(sessionId, {
      tool: "recall", keywords: args.keywords || [args.text?.substring(0, 30)],
      searchPath: result.searchPath
    }).catch(() => {});

    /** 1-hop 링크 파편 조회 (Task 4-2) */
    const fragmentIds = result.fragments.map(f => f.id);
    const linkedMap   = await fetchLinkedFragments(fragmentIds).catch((err) => {
      logWarn("fetchLinkedFragments failed", { error: err.message, count: fragmentIds.length });
      return new Map();
    });

    /** 시간 인접 번들링: includeContext=true 시 같은 세션의 30분 이내 파편 첨부 */
    if (args.includeContext) {
      const agentId = args.agentId || "default";
      const keyId   = args._keyId ?? null;
      for (const frag of result.fragments) {
        if (frag.session_id) {
          const nearby = await mgr.store.searchBySource(
            `session:${frag.session_id}`, agentId, keyId
          );
          frag.nearby_context = nearby
            .filter(n => n.id !== frag.id)
            .filter(n => {
              const diff = Math.abs(new Date(n.created_at) - new Date(frag.created_at));
              return diff < 30 * 60 * 1000;
            })
            .slice(0, 3)
            .map(n => ({ id: n.id, content: n.content, type: n.type, created_at: n.created_at }));
        }
      }
    }

    const fragments = result.fragments.map(f => ({
      id          : f.id,
      content     : f.content,
      topic       : f.topic,
      type        : f.type,
      importance  : f.importance,
      created_at  : f.created_at,
      age_days    : Math.floor((Date.now() - new Date(f.created_at).getTime()) / 86400000),
      access_count: f.access_count || 0,
      confidence  : computeConfidence(f.utility_score),
      linked      : linkedMap.get(f.id) || [],
      ...(f.similarity !== undefined  ? { similarity: f.similarity }         : {}),
      ...(f.metadata?.stale           ? { stale_warning: f.metadata.warning } : {}),
      ...(args.includeKeywords        ? { keywords: f.keywords ?? [] }        : {}),
      ...(f.context_summary           ? { context_summary: f.context_summary } : {}),
      ...(f.nearby_context?.length    ? { nearby_context: f.nearby_context }   : {})
    }));

    return {
      success        : true,
      fragments,
      count          : fragments.length,
      totalTokens    : result.totalTokens,
      searchPath     : result.searchPath,
      _searchEventId : result._searchEventId ?? null
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function tool_forget(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.forget(args);
    await logAudit("forget", {
      fragmentId: args.id   || "-",
      topic     : args.topic || "-",
      success   : true,
      details   : result.deleted ? `deleted ${result.deleted}` : undefined
    });
    SessionActivityTracker.record(sessionId, { tool: "forget" }).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    await logAudit("forget", {
      fragmentId: args.id || "-",
      success   : false,
      details   : err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_link(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.link(args);
    await logAudit("link", {
      fragmentId: args.fromId || "-",
      success   : true,
      details   : `${args.fromId} -> ${args.toId}`
    });
    SessionActivityTracker.record(sessionId, { tool: "link" }).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    await logAudit("link", {
      success: false,
      details: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_amend(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.amend(args);
    await logAudit("amend", {
      fragmentId: args.id,
      success   : result.updated,
      details   : result.merged ? `merged with ${result.existingId}` : undefined
    });
    SessionActivityTracker.record(sessionId, { tool: "amend", fragmentId: args.id }).catch(() => {});
    return { success: result.updated, ...result };
  } catch (err) {
    await logAudit("amend", {
      fragmentId: args.id,
      success   : false,
      details   : err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_reflect(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  if (sessionId && !args.sessionId) args.sessionId = sessionId;
  try {
    const result = await mgr.reflect(args);
    await logAudit("reflect", {
      sessionId : args.sessionId,
      count     : result.count,
      success   : true
    });
    SessionActivityTracker.record(sessionId, { tool: "reflect" }).catch(() => {});
    SessionActivityTracker.markReflected(sessionId).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    await logAudit("reflect", {
      success: false,
      details: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_context(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  if (sessionId && !args.sessionId) args.sessionId = sessionId;
  try {
    const result = await mgr.context(args);
    SessionActivityTracker.record(sessionId, { tool: "context" }).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function tool_toolFeedback(args) {
  delete args._sessionId;
  const mgr = MemoryManager.getInstance();
  try {
    const result = await mgr.toolFeedback(args);
    await logAudit("tool_feedback", {
      tool_name : args.tool_name,
      relevant  : args.relevant,
      sufficient: args.sufficient,
      success   : true
    });
    return { success: true, ...result };
  } catch (err) {
    await logAudit("tool_feedback", {
      tool_name: args.tool_name,
      success  : false,
      details  : err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_memoryStats(args) {
  delete args._sessionId;
  const mgr = MemoryManager.getInstance();
  try {
    const result          = await mgr.stats();
    const searchMetrics   = await getSearchMetrics();
    const searchLatencyMs = await searchMetrics.getStats();

    const { computeRollingPrecision, computeTaskSuccessRate } = await import("../memory/EvaluationMetrics.js");
    const [evaluation, taskSuccess, searchObs] = await Promise.all([
      computeRollingPrecision(100).catch(() => ({ precision_at_5: null, sample_sessions: 0, sufficient_rate: null })),
      computeTaskSuccessRate(30).catch(() => ({ success_rate: null, total_sessions: 0 })),
      getSearchObservability(30).catch(() => null)
    ]);

    return {
      success: true,
      stats: {
        ...result,
        searchLatencyMs,
        evaluation: {
          rolling_precision_at_5: evaluation.precision_at_5,
          sufficient_rate        : evaluation.sufficient_rate,
          sample_sessions        : evaluation.sample_sessions,
          task_success_rate      : taskSuccess.success_rate,
          task_sessions          : taskSuccess.total_sessions
        },
        searchObservability: searchObs
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function tool_memoryConsolidate(args) {
  const keyId = args._keyId ?? null;
  delete args._sessionId;
  if (keyId != null) {
    return { success: false, error: "memory_consolidate is master-key only" };
  }
  const mgr = MemoryManager.getInstance();
  try {
    const result = await mgr.consolidate();
    await logAudit("consolidate", {
      success: true,
      details: result.summary || undefined
    });
    return { success: true, ...result };
  } catch (err) {
    await logAudit("consolidate", { success: false, details: err.message });
    return { success: false, error: err.message };
  }
}

export async function tool_graphExplore(args) {
  delete args._sessionId;
  const mgr = MemoryManager.getInstance();
  try {
    const result = await mgr.graphExplore(args);
    if (result.error) {
      return { success: false, ...result };
    }
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function tool_fragmentHistory(args) {
  delete args._sessionId;
  const mgr = MemoryManager.getInstance();
  try {
    const result = await mgr.fragmentHistory(args);
    if (result.error) {
      return { success: false, ...result };
    }
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
