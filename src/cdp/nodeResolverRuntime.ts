import type { CDPClient } from './client'
import type { NodeMappingResult, TargetFingerprint } from './nodeMappingTypes'

type RuntimeEvaluateByValueResponse<T> = {
  result?: {
    value?: T
  }
}

type RuntimeEvaluateRemoteObjectResponse = {
  result?: {
    objectId?: string
    subtype?: string
    type?: string
  }
}

type RuntimeResolverValue = {
  resolved: boolean
  confidence: number
  evidence: string[]
  candidateCount: number
  score: number
  scoreDelta?: number
  ambiguousCount?: number
  topCandidates?: Array<{ tag: string; id?: string; score: number; penaltyPoints: number }>
  ambiguous?: boolean
}

type DOMRequestNodeResponse = {
  nodeId: number
}

type DOMDescribeNodeResponse = {
  node?: {
    backendNodeId?: number
    nodeName?: string
  }
}

type ConfidenceCalibrationInput = {
  score: number
  scoreDelta: number
  penaltyPoints: number
  ambiguousCount: number
}

export const scoreToConfidence = ({ score, scoreDelta, penaltyPoints, ambiguousCount }: ConfidenceCalibrationInput) => {
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
  const baseConfidence = Math.min(0.97, Math.max(0.18, score / 130))
  const marginBonus = Math.min(0.08, Math.max(0, scoreDelta / 35))
  const driftPenalty = Math.min(0.3, Math.max(0, penaltyPoints / 45))
  const ambiguityPenalty = ambiguousCount > 1 ? Math.min(0.22, (ambiguousCount - 1) * 0.07) : 0
  return clamp01(Math.max(0.05, baseConfidence + marginBonus - driftPenalty - ambiguityPenalty))
}

const buildRuntimeResolverExpression = (fingerprint: TargetFingerprint, returnNode: boolean) => {
  const serialized = JSON.stringify(fingerprint)

  return `(() => {
    const fp = ${serialized};
    const normalize = (value) => String(value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    const toSet = (list) => new Set((list || []).map((v) => normalize(v)).filter(Boolean));
    const fpText = normalize(fp.textPreview || '').slice(0, 220);
    const fpClasses = toSet(fp.classList || []);
    const fpAttrs = Array.isArray(fp.attributeHints) ? fp.attributeHints : [];
    const fpAncestry = Array.isArray(fp.ancestry) ? fp.ancestry : [];
    const fpShadow = fp.shadowContext || { insideShadowRoot: false, shadowDepth: 0, hostChain: [] };
    const SCORE_WEIGHTS = {
      tag: 26,
      id: 34,
      classPerMatch: 4,
      classMax: 20,
      textStrong: 18,
      textWeak: 8,
      siblingIndex: 8,
      childExact: 6,
      childNear: 2,
      attrPerMatch: 5,
      attrMax: 18,
      ancestryTag: 4,
      ancestryId: 4,
      ancestryClass: 1,
      ancestryMax: 20,
      shadowInsideMatch: 4,
      shadowDepthExact: 6,
      shadowDepthNear: 2,
      shadowHostPerMatch: 3,
      shadowHostMax: 10,
      boundsIouStrong: 26,
      boundsIouMedium: 16,
      boundsCenterNear: 8,
      boundsAreaNear: 4,
      boundsAreaLoose: 2,
    };
    const SCORE_PENALTIES = {
      textDrift: 8,
      childCountDrift: 6,
      shadowInsideMismatch: 12,
      shadowDepthDrift: 6,
      shadowHostMismatch: 8,
      boundsDrift: 8,
      boundsAreaDrift: 6,
    };
    const SCORE_THRESHOLDS = {
      minResolvedScore: 28,
      ambiguousDelta: 12,
      topCandidateWindow: 12,
    };

    const getSiblingIndex = (el) => {
      const p = el && el.parentElement;
      if (!p) return -1;
      return Array.prototype.indexOf.call(p.children, el);
    };

    const getShadowContext = (el) => {
      const hostChain = [];
      let shadowDepth = 0;
      let node = el;
      while (node) {
        const root = node.getRootNode && node.getRootNode();
        if (!(root instanceof ShadowRoot) || !root.host) break;
        shadowDepth += 1;
        const host = root.host;
        hostChain.push(normalize(host.tagName + (host.id ? '#' + host.id : '')));
        node = host;
      }
      return { insideShadowRoot: shadowDepth > 0, shadowDepth, hostChain };
    };

    const getBoundsScore = (el) => {
      const b = el.getBoundingClientRect();
      if (!fp.boundingBox) return { score: 0, penalties: 0, evidence: [] };
      const a = fp.boundingBox;
      const ax2 = a.x + a.width;
      const ay2 = a.y + a.height;
      const bx2 = b.left + b.width;
      const by2 = b.top + b.height;
      const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.left));
      const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.top));
      const intersection = ix * iy;
      const union = Math.max(1, a.width * a.height + b.width * b.height - intersection);
      const iou = intersection / union;
      const areaRatio = Math.max(a.width * a.height, b.width * b.height) / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
      if (iou >= 0.6) {
        const areaScore = areaRatio <= 1.5 ? SCORE_WEIGHTS.boundsAreaNear : areaRatio <= 2.2 ? SCORE_WEIGHTS.boundsAreaLoose : 0;
        return { score: SCORE_WEIGHTS.boundsIouStrong + areaScore, penalties: 0, evidence: ['bounding-box IoU >= 0.6'] };
      }
      if (iou >= 0.35) {
        const areaScore = areaRatio <= 1.8 ? SCORE_WEIGHTS.boundsAreaLoose : 0;
        return { score: SCORE_WEIGHTS.boundsIouMedium + areaScore, penalties: 0, evidence: ['bounding-box IoU >= 0.35'] };
      }

      const acx = a.x + a.width / 2;
      const acy = a.y + a.height / 2;
      const bcx = b.left + b.width / 2;
      const bcy = b.top + b.height / 2;
      const distance = Math.hypot(acx - bcx, acy - bcy);
      const norm = Math.max(1, Math.max(a.width, a.height));
      if (distance / norm <= 0.6) {
        return { score: SCORE_WEIGHTS.boundsCenterNear, penalties: 0, evidence: ['bounding-box center near expected'] };
      }
      const penalties = areaRatio > 3 ? SCORE_PENALTIES.boundsDrift + SCORE_PENALTIES.boundsAreaDrift : SCORE_PENALTIES.boundsDrift;
      return { score: 0, penalties, evidence: ['bounding-box drift: low overlap and distant center'] };
    };

    const tokenOverlap = (left, right) => {
      const leftTokens = new Set(normalize(left).split(' ').filter(Boolean));
      const rightTokens = new Set(normalize(right).split(' ').filter(Boolean));
      if (!leftTokens.size || !rightTokens.size) return 0;
      let matches = 0;
      leftTokens.forEach((token) => {
        if (rightTokens.has(token)) matches += 1;
      });
      return matches / Math.max(leftTokens.size, rightTokens.size);
    };

    const scoreCandidate = (el) => {
      let score = 0;
      let penaltyPoints = 0;
      const evidence = [];

      if (normalize(el.tagName) === normalize(fp.tagName)) {
        score += SCORE_WEIGHTS.tag;
        evidence.push('tag match');
      }

      if (fp.id && normalize(el.id) === normalize(fp.id)) {
        score += SCORE_WEIGHTS.id;
        evidence.push('id match');
      }

      const candidateClasses = toSet(Array.from(el.classList || []));
      let classMatches = 0;
      fpClasses.forEach((cls) => {
        if (candidateClasses.has(cls)) classMatches += 1;
      });
      if (classMatches > 0) {
        const classScore = Math.min(SCORE_WEIGHTS.classMax, classMatches * SCORE_WEIGHTS.classPerMatch);
        score += classScore;
        evidence.push('class overlap: ' + classMatches);
      }

      if (fpText) {
        const candidateText = normalize(el.textContent || '').slice(0, 280);
        if (candidateText && (candidateText.includes(fpText) || fpText.includes(candidateText.slice(0, 80)))) {
          score += SCORE_WEIGHTS.textStrong;
          evidence.push('text preview overlap');
        } else if (candidateText) {
          const overlap = tokenOverlap(candidateText, fpText);
          if (overlap >= 0.45) {
            score += SCORE_WEIGHTS.textWeak;
            evidence.push('text token overlap >= 0.45');
          } else {
            score -= SCORE_PENALTIES.textDrift;
            penaltyPoints += SCORE_PENALTIES.textDrift;
            evidence.push('text drift detected (low token overlap)');
          }
        }
      }

      if (typeof fp.siblingIndex === 'number') {
        const idx = getSiblingIndex(el);
        if (idx === fp.siblingIndex) {
          score += SCORE_WEIGHTS.siblingIndex;
          evidence.push('sibling index match');
        }
      }

      if (typeof fp.childCount === 'number') {
        const count = el.children ? el.children.length : 0;
        if (count === fp.childCount) {
          score += SCORE_WEIGHTS.childExact;
          evidence.push('child count match');
        } else if (Math.abs(count - fp.childCount) <= 2) {
          score += SCORE_WEIGHTS.childNear;
          evidence.push('child count near');
        } else {
          score -= SCORE_PENALTIES.childCountDrift;
          penaltyPoints += SCORE_PENALTIES.childCountDrift;
          evidence.push('child count drift detected');
        }
      }

      if (fpAttrs.length > 0) {
        let attrMatches = 0;
        fpAttrs.forEach((a) => {
          const current = el.getAttribute && el.getAttribute(a.name);
          if (current && normalize(current) === normalize(a.value)) attrMatches += 1;
        });
        if (attrMatches > 0) {
          score += Math.min(SCORE_WEIGHTS.attrMax, attrMatches * SCORE_WEIGHTS.attrPerMatch);
          evidence.push('attribute hints match: ' + attrMatches);
        }
      }

      if (fpAncestry.length > 0) {
        let current = el.parentElement;
        let ancestryScore = 0;
        for (let i = 0; i < Math.min(5, fpAncestry.length); i += 1) {
          if (!current) break;
          const expected = fpAncestry[i];
          if (normalize(current.tagName) === normalize(expected.tagName)) ancestryScore += SCORE_WEIGHTS.ancestryTag;
          if (expected.id && normalize(current.id) === normalize(expected.id)) ancestryScore += SCORE_WEIGHTS.ancestryId;
          const expectedClasses = toSet(expected.classList || []);
          if (expectedClasses.size > 0) {
            const currentClasses = toSet(Array.from(current.classList || []));
            expectedClasses.forEach((c) => {
              if (currentClasses.has(c)) ancestryScore += SCORE_WEIGHTS.ancestryClass;
            });
          }
          current = current.parentElement;
        }
        if (ancestryScore > 0) {
          score += Math.min(SCORE_WEIGHTS.ancestryMax, ancestryScore);
          evidence.push('ancestry alignment');
        }
      }

      const shadow = getShadowContext(el);
      if (!!fpShadow.insideShadowRoot === !!shadow.insideShadowRoot) {
        score += SCORE_WEIGHTS.shadowInsideMatch;
      } else {
        score -= SCORE_PENALTIES.shadowInsideMismatch;
        penaltyPoints += SCORE_PENALTIES.shadowInsideMismatch;
        evidence.push('shadow root context mismatch');
      }
      if (fpShadow.insideShadowRoot && shadow.insideShadowRoot) {
        if (fpShadow.shadowDepth === shadow.shadowDepth) {
          score += SCORE_WEIGHTS.shadowDepthExact;
          evidence.push('shadow depth match');
        } else if (Math.abs(fpShadow.shadowDepth - shadow.shadowDepth) === 1) {
          score += SCORE_WEIGHTS.shadowDepthNear;
          evidence.push('shadow depth near');
        } else {
          score -= SCORE_PENALTIES.shadowDepthDrift;
          penaltyPoints += SCORE_PENALTIES.shadowDepthDrift;
          evidence.push('shadow depth drift detected');
        }
        if (Array.isArray(fpShadow.hostChain) && fpShadow.hostChain.length > 0) {
          const expected = fpShadow.hostChain.map((h) => normalize(h));
          const actual = shadow.hostChain;
          let chainMatches = 0;
          for (let i = 0; i < Math.min(expected.length, actual.length); i += 1) {
            if (actual[i] && expected[i] && actual[i].includes(expected[i])) chainMatches += 1;
          }
          if (chainMatches > 0) {
            score += Math.min(SCORE_WEIGHTS.shadowHostMax, chainMatches * SCORE_WEIGHTS.shadowHostPerMatch);
            evidence.push('shadow host chain overlap: ' + chainMatches);
          } else {
            score -= SCORE_PENALTIES.shadowHostMismatch;
            penaltyPoints += SCORE_PENALTIES.shadowHostMismatch;
            evidence.push('shadow host chain mismatch');
          }
        }
      }

      const bounds = getBoundsScore(el);
      score += bounds.score;
      penaltyPoints += bounds.penalties;
      evidence.push(...bounds.evidence);

      return { element: el, score, penaltyPoints, evidence };
    };

    const tagSelector = (fp.tagName || '*').toLowerCase();
    const all = Array.from(document.querySelectorAll(tagSelector));
    const scored = all.map(scoreCandidate).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

    if (!scored.length) {
      ${returnNode ? 'return null;' : "return { resolved: false, confidence: 0, evidence: ['no candidates scored above zero'], candidateCount: 0, score: 0 };"}
    }

    const best = scored[0];
    const second = scored[1];
    const scoreDelta = second ? best.score - second.score : best.score;
    const ambiguousCount = scored.filter((candidate) => (best.score - candidate.score) < SCORE_THRESHOLDS.topCandidateWindow).length;
    const ambiguous = !!second && scoreDelta < SCORE_THRESHOLDS.ambiguousDelta;
    const confidence = ${scoreToConfidence.toString()}({
      score: best.score,
      scoreDelta,
      penaltyPoints: best.penaltyPoints,
      ambiguousCount,
    });
    const topCandidates = scored.slice(0, 3).map((candidate) => ({
      tag: normalize(candidate.element.tagName),
      id: candidate.element.id || undefined,
      score: candidate.score,
      penaltyPoints: candidate.penaltyPoints,
    }));

    if (best.score < SCORE_THRESHOLDS.minResolvedScore) {
      ${returnNode ? 'return null;' : "return { resolved: false, confidence, evidence: ['best candidate score below threshold', 'score delta to 2nd: ' + scoreDelta, ...best.evidence.slice(0, 8)], candidateCount: scored.length, score: best.score, scoreDelta, ambiguousCount, topCandidates, ambiguous };"}
    }

    ${returnNode ? 'return best.element;' : "return { resolved: true, confidence, evidence: ['score delta to 2nd: ' + scoreDelta, ...best.evidence.slice(0, 10)], candidateCount: scored.length, score: best.score, scoreDelta, ambiguousCount, topCandidates, ambiguous };"}
  })()`
}

const summarizeTopCandidates = (candidates: RuntimeResolverValue['topCandidates']) => {
  if (!candidates?.length) return []
  const summary = candidates
    .map((candidate) => `${candidate.tag}${candidate.id ? `#${candidate.id}` : ''}:${candidate.score}(-${candidate.penaltyPoints})`)
    .join(', ')
  return [`top runtime candidates (score/penalty): ${summary}`]
}

const toResolverFailure = (reason: string): NodeMappingResult => ({
  resolved: false,
  confidence: 0,
  strategy: 'unresolved',
  evidence: [],
  warnings: [reason],
})

export const resolveNodeByRuntimeFingerprint = async (
  client: CDPClient,
  fingerprint: TargetFingerprint,
): Promise<NodeMappingResult> => {
  const summaryResponse = await client.send<RuntimeEvaluateByValueResponse<RuntimeResolverValue>>('Runtime.evaluate', {
    expression: buildRuntimeResolverExpression(fingerprint, false),
    returnByValue: true,
    awaitPromise: false,
  })

  const summary = summaryResponse.result?.value
  if (!summary) return toResolverFailure('runtime resolver returned no summary payload')

  if (!summary.resolved) {
    return {
      resolved: false,
      confidence: summary.confidence,
      strategy: 'unresolved',
      evidence: [...summary.evidence, ...summarizeTopCandidates(summary.topCandidates)],
      warnings: ['runtime structural mapping did not find a strong candidate'],
      candidateCount: summary.candidateCount,
    }
  }

  const nodeResponse = await client.send<RuntimeEvaluateRemoteObjectResponse>('Runtime.evaluate', {
    expression: buildRuntimeResolverExpression(fingerprint, true),
    returnByValue: false,
    awaitPromise: false,
  })

  const remote = nodeResponse.result
  if (!remote?.objectId || remote.subtype !== 'node') {
    return toResolverFailure('runtime resolver did not return a node object')
  }

  const requested = await client.send<DOMRequestNodeResponse>('DOM.requestNode', { objectId: remote.objectId })
  if (!requested?.nodeId) {
    return toResolverFailure('DOM.requestNode returned no nodeId')
  }

  const described = await client.send<DOMDescribeNodeResponse>('DOM.describeNode', { nodeId: requested.nodeId })

  return {
    resolved: true,
    confidence: summary.confidence,
    strategy: 'runtime-structural',
    evidence: [...summary.evidence, ...summarizeTopCandidates(summary.topCandidates)],
    candidateCount: summary.candidateCount,
    node: {
      objectId: remote.objectId,
      nodeId: requested.nodeId,
      backendNodeId: described.node?.backendNodeId,
    },
    warnings:
      summary.ambiguous || (summary.ambiguousCount || 0) > 1
        ? [`multiple close runtime candidates detected (within ${summary.scoreDelta ?? '?'} points)`]
        : undefined,
  }
}
