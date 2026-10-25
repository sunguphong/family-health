import Anthropic from '@anthropic-ai/sdk';
import type { ItemDef } from '../types';
import { newKey, type Candidate } from './parse';

export const AI_MODEL = 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  properties: {
    examDate: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '검진일 YYYY-MM-DD, 없으면 null' },
    institution: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '검진 기관명, 없으면 null' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rawName: { type: 'string' },
          itemCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          value: { type: 'string' },
          unit: { type: 'string' },
        },
        required: ['rawName', 'itemCode', 'value', 'unit'],
        additionalProperties: false,
      },
    },
  },
  required: ['examDate', 'institution', 'items'],
  additionalProperties: false,
} as const;

interface AiOutput {
  examDate: string | null;
  institution: string | null;
  items: { rawName: string; itemCode: string | null; value: string; unit: string }[];
}

function prompt(items: ItemDef[]) {
  const list = items.map((d) => `- ${d.code}: ${d.name}${d.unit ? ` (${d.unit})` : ''}`).join('\n');
  return `첨부한 이미지는 한국 건강검진 결과지의 페이지들입니다. 개인 식별정보는 미리 검은 칸으로 가려 두었습니다.

결과지에 적힌 검사 항목과 "본인의 측정값"을 모두 뽑아 주세요.
- rawName: 결과지에 적힌 항목명 그대로
- value: 결과지에 적힌 값 그대로 (숫자는 숫자만, 요단백 같은 단계형은 "음성", "약양성", "양성(+1)" 등 그대로)
- unit: 결과지에 적힌 단위 (없으면 빈 문자열)
- itemCode: 아래 표준 항목 중 같은 검사이면 그 코드, 해당 없으면 null
- 혈압이 "120/80"처럼 한 칸이면 sbp와 dbp 두 개로 나눠 주세요.
- 참고치·정상범위·판정 기준 숫자, 이전 연도 값은 넣지 마세요.
- 읽을 수 없거나 확실하지 않은 값은 지어내지 말고 빼 주세요.
- 이름, 주민등록번호, 주소, 전화번호 같은 개인정보는 어떤 필드에도 넣지 마세요.

표준 항목:
${list}`;
}

export async function extractWithClaude(
  apiKey: string,
  pages: Blob[],
  items: ItemDef[],
): Promise<{ candidates: Candidate[]; examDate: string | null; institution: string | null }> {
  // 개인용 로컬 앱에서 본인 키를 직접 쓰는 구조라 브라우저 호출을 허용한다. 키는 이 기기의 IndexedDB에만 저장된다.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const images = await Promise.all(
    pages.slice(0, 20).map(async (b) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: await blobToBase64(b) },
    })),
  );

  let res;
  try {
    res = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [...images, { type: 'text', text: prompt(items) }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API 키가 올바르지 않습니다. 설정에서 키를 확인해 주세요.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('이 API 키로는 해당 모델을 쓸 수 없습니다.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Anthropic 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    if (e instanceof Anthropic.APIError) throw new Error(`AI 추출 실패 (${e.status ?? '오류'}): ${e.message}`);
    throw e;
  }

  if (res.stop_reason === 'refusal') throw new Error('AI가 이 파일 처리를 거절했습니다. 로컬 추출 결과를 사용해 주세요.');
  if (res.stop_reason === 'max_tokens') throw new Error('AI 응답이 너무 길어 잘렸습니다. 페이지 수를 줄여 다시 시도해 주세요.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let out: AiOutput;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error('AI 응답을 해석하지 못했습니다.');
  }
  const codes = new Set(items.map((d) => d.code));
  return {
    examDate: out.examDate,
    institution: out.institution,
    candidates: out.items.map((it) => ({
      key: newKey(),
      rawName: it.rawName,
      rawValue: it.value,
      itemCode: it.itemCode && codes.has(it.itemCode) ? it.itemCode : '',
      value: it.value,
      unit: it.unit,
      source: 'ai' as const,
    })),
  };
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** 설정 화면의 '연결 확인'용 짧은 호출 */
export async function testApiKey(apiKey: string) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  await client.models.retrieve(AI_MODEL);
}
