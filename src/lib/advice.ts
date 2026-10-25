import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from './extract/ai';
import { getSetting, setSetting } from './db';
import { ageOf, formatValue, isWorseningTrend, rangeText, type Point } from './status';
import { GROUPS, STATUS_LABEL, type Exam, type ItemDef, type Member } from './types';

export interface Advice {
  summary: string;
  points: { title: string; level: 'good' | 'watch' | 'consult'; text: string }[];
  habits: string[];
  askDoctor: string[];
}

export interface SavedAdvice {
  hash: string;
  createdAt: number;
  advice: Advice;
}

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          level: { type: 'string', enum: ['good', 'watch', 'consult'] },
          text: { type: 'string' },
        },
        required: ['title', 'level', 'text'],
        additionalProperties: false,
      },
    },
    habits: { type: 'array', items: { type: 'string' } },
    askDoctor: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'points', 'habits', 'askDoctor'],
  additionalProperties: false,
} as const;

const SYSTEM = `당신은 개인 건강검진 기록 앱의 해설 도우미입니다. 의료인이 아닌 사용자가 자신의 연도별 검진 수치를 이해하도록 돕습니다.

지켜야 할 것:
- 진단, 병명 단정, 약 이름·복용·용량 제안, 치료 지시는 하지 않습니다. "~일 수 있습니다", "~경향이 보입니다" 정도로만 표현합니다.
- 수치의 변화와 참고 범위 대비 위치를 쉬운 말로 설명하고, 일반적인 생활 습관(식사·운동·수면·음주 등) 수준의 제안만 합니다.
- 참고 범위를 벗어났거나 계속 나빠지는 항목은 "의료진과 상담해 보세요"로 안내합니다.
- 좋아졌거나 안정적인 항목도 짚어 주어 균형 있게 씁니다.
- 한국어, 존댓말, 간결하게. 숫자를 말할 때는 단위를 붙입니다.

출력 형식:
- summary: 전체 흐름 2~3문장
- points: 눈여겨볼 항목 3~6개. level은 good(좋음·안정), watch(지켜보기), consult(상담 권장)
- habits: 일반적인 생활 습관 제안 3~5개
- askDoctor: 다음 진료 때 물어볼 만한 질문 2~4개`;

/** AI에 보낼 데이터. 이름·기관명·원본 이미지는 넣지 않는다 */
export function buildPayload(member: Member, exams: Exam[], items: ItemDef[], series: Map<string, Point[]>) {
  const age = ageOf(member.birthYear);
  const lines: string[] = [];
  lines.push(`성별: ${member.sex === 'M' ? '남' : '여'}${age ? `, 나이대: ${Math.floor(age / 10) * 10}대` : ''}`);
  lines.push(`검진 날짜: ${exams.map((e) => e.date).join(', ')}`);
  lines.push('');
  for (const g of GROUPS) {
    const defs = items.filter((d) => d.group === g.key && series.get(d.code)?.length);
    if (!defs.length) continue;
    lines.push(`[${g.label}]`);
    for (const d of defs) {
      const pts = series.get(d.code)!;
      const vals = pts.map((p) => `${p.date.slice(0, 4)}년 ${formatValue(d, p.value)}${p.status !== 'none' ? `(${STATUS_LABEL[p.status]})` : ''}`).join(' → ');
      const unit = d.kind === 'grade' ? '' : ` ${d.unit}`;
      const trend = isWorseningTrend(d, member.sex, pts) ? ' · 최근 3회 연속 악화 방향' : '';
      lines.push(`- ${d.name}${unit} | 참고범위 ${rangeText(d, member.sex)} | ${vals}${trend}`);
    }
  }
  return lines.join('\n');
}

export const hashPayload = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
};

export const loadAdvice = (memberId: number) => getSetting<SavedAdvice | null>(`advice:${memberId}`, null);

export async function requestAdvice(apiKey: string, memberId: number, payload: string): Promise<SavedAdvice> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let res;
  try {
    res = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `아래는 한 사람의 연도별 건강검진 수치입니다. 흐름을 해설해 주세요.\n\n${payload}` }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API 키가 올바르지 않습니다. 설정에서 키를 확인해 주세요.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Anthropic 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    if (e instanceof Anthropic.APIError) throw new Error(`AI 요청 실패 (${e.status ?? '오류'}): ${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('AI가 응답을 거절했습니다. 잠시 후 다시 시도해 주세요.');
  if (res.stop_reason === 'max_tokens') throw new Error('AI 응답이 잘렸습니다. 다시 시도해 주세요.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let advice: Advice;
  try {
    advice = JSON.parse(text);
  } catch {
    throw new Error('AI 응답을 해석하지 못했습니다.');
  }
  const saved: SavedAdvice = { hash: hashPayload(payload), createdAt: Date.now(), advice };
  await setSetting(`advice:${memberId}`, saved);
  return saved;
}
