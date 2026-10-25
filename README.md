# 우리집 건강검진

가족 건강검진 결과(PDF·JPG·PNG)를 올리면 수치를 읽어 저장하고, 연도별 추이를 보여 주는 개인용 웹앱입니다.

## 실행

- **간단 실행**: `실행.bat` 더블클릭. 그러면 http://localhost:4173 이 열립니다.
- **개발 모드**: `npm install` → `npm run dev`
- **다시 빌드**: `npm run build` (코드를 고친 뒤 `실행.bat`을 쓰려면 `dist` 폴더를 지우거나 다시 빌드)

처음 실행하면 가상 샘플 데이터(구성원 2명, 2022~2025년)가 들어갑니다. 설정 → 데이터 관리에서 지울 수 있습니다.

## 데이터와 개인정보

- 모든 기록은 **이 브라우저의 IndexedDB**에만 저장됩니다. 서버는 없습니다.
  - 브라우저나 주소(포트)가 바뀌면 데이터가 보이지 않습니다. 기기를 옮길 때는 설정 → 백업 파일 저장/복원을 쓰세요.
- 원본 파일은 저장하지 않습니다. 대신 페이지를 이미지로 바꾸고, 주민등록번호·외국인등록번호·휴대전화 번호로 보이는 부분을 검은 칸으로 가린 사본만 저장합니다.
  - 이름·주소는 자동으로 가리지 못합니다. 검토 화면의 '직접 가리기'로 덮을 수 있습니다.
- **로컬 추출**:
  - 텍스트 PDF는 pdf.js로 읽고, 스캔본·이미지는 Tesseract.js OCR로 읽습니다. 처리는 모두 브라우저 안에서 이뤄집니다.
  - 단, OCR 엔진과 한국어 언어 데이터는 처음 한 번 CDN(jsdelivr)에서 내려받습니다. 파일 내용은 보내지 않습니다.
- **AI 추출(선택, 기본 꺼짐)**:
  - 설정에서 켜고 본인의 Anthropic API 키를 넣어야 동작합니다.
  - 전송할 때마다 보낼 이미지를 미리 보여 주고 동의를 받은 뒤, 가린 페이지 이미지만 Claude API(`claude-opus-5-5`)로 보냅니다.
  - API 키는 브라우저 저장소에 보관됩니다. 개인 PC에서만 쓰세요.

## 판정 기준

국민건강보험공단 일반건강검진 판정 기준을 바탕으로 한 일반적인 참고값이며, 설정에서 항목별로 바꿀 수 있습니다.

| 표시 | 기준 |
|---|---|
| 정상 / 주의 / 이상 | 정상 범위 안 / 주의 범위 안 / 그 밖 |
| 크게 변한 항목 | 직전 검진 대비 ±15% 이상 변했거나 판정 단계가 바뀐 경우 |
| 3회 연속 악화 | 최근 3회 값이 계속 나쁜 방향으로 움직이고 전체 변화가 5% 이상인 경우 |

이 표시는 진단이 아닙니다.

## 구조

```
src/lib/items.ts          항목 정의·별칭·기본 기준
src/lib/db.ts             IndexedDB(Dexie) 스키마
src/lib/status.ts         판정·추이 계산
src/lib/extract/          pages(PDF/OCR) · mask(식별정보 가림) · parse(항목 매칭) · ai(Claude)
src/lib/export.ts         CSV·엑셀·백업
src/pages/                대시보드·기록·상세·업로드·설정·인쇄 요약
```

## 온라인 주소 (GitHub Pages)

https://sunguphong.github.io/family-health/

- 코드를 고친 뒤 `npm run deploy`를 실행하면 `gh-pages` 브랜치로 배포되고, 1~2분 뒤 위 주소에 반영됩니다.
- 저장소에는 앱 코드만 있습니다. 건강 기록·API 키는 각 브라우저에만 저장되므로, 기기·주소가 바뀌면 설정의 백업·복원으로 옮기세요.

## 서버 저장(Supabase)과 사용자 관리

앱에는 가입 기능이 없고 **로그인만** 있습니다. 계정은 관리자(Supabase 프로젝트 소유자)만 만들고 지울 수 있습니다.

### 처음 설정 (관리자, 한 번)
1. Supabase 프로젝트를 만들고(Region: Seoul) **SQL Editor**에서 `supabase/setup.sql` 전체를 실행합니다.
2. `src/config.ts`에 Project URL과 anon(publishable) 키를 넣고 `npm run deploy` 합니다.
3. **Authentication → Sign In / Providers → Email**에서 **Allow new users to sign up을 끕니다.**
   앱에 가입 버튼이 없어도, 이 설정을 꺼야 다른 경로로도 가입할 수 없습니다.
4. **Authentication → URL Configuration**의 Site URL을 `https://sunguphong.github.io/family-health/`로 둡니다.

### 사용자 추가·삭제 (관리자)
- **추가:** Authentication → Users → **Add user → Create new user**에서 이메일·임시 비밀번호를 넣고 **Auto Confirm User**를 체크합니다.
- **비밀번호 초기화:** 같은 화면에서 해당 사용자의 비밀번호를 새로 정하거나 **Send password recovery**를 보냅니다.
- **삭제:** 사용자 행의 메뉴 → **Delete user**. 그 사람의 서버 기록도 함께 지워집니다.
- 계정마다 기록과 데이터 비밀번호가 따로입니다. 다른 사람의 기록은 관리자도 열어 볼 수 없습니다(암호화).
