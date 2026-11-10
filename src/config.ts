/**
 * Supabase 연결 정보. 둘 다 '공개용' 값이라 코드에 넣어도 되며,
 * 실제 접근 제한은 서버의 행 단위 보안(RLS)과 로그인으로 이뤄진다. (supabase/setup.sql 참고)
 * 비어 있으면 서버 없이 이 기기에만 저장하는 모드로 동작한다.
 */
export const SUPABASE_URL = 'https://ttkqsvrzvmvciefxsffr.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ljEHEOlw1PDXQAa1y84uXw_WQ_ADJzi';

export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

/** 관리자 메뉴(인프라 구성도 등)를 볼 수 있는 계정. 서버 저장 모드가 아니면 누구나 관리자 */
export const ADMIN_EMAILS = ['upsan77@naver.com'];
