# vibisual — landing site

[Vibisual](https://github.com/Vibisual/vibisual) 랜딩 페이지의 소스입니다.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 페이지 전체(마크업 · 스타일 · 배경 캔버스 · 12개 언어 문안). 단일 파일입니다. |
| `support.js` | `dc-runtime` 빌드 산출물. `<x-dc>` 템플릿을 읽어 브라우저에서 렌더링합니다. |
| `fonts/` | 자체 호스팅 웹폰트(woff2 + `fonts.css`). 라이선스는 `fonts/LICENSE.md`. |
| `favicon.svg` · `og.png` | 탭 아이콘과 공유 카드 이미지 |

## 로컬에서 보기

`file://` 로 열면 브라우저 보안 정책에 걸리므로 정적 서버로 띄웁니다.

```bash
npx serve .
# 또는
python -m http.server 8080
```

루트로 들어가면 바로 페이지가 뜹니다.

## 공개 지표와 근거

홈페이지의 숫자는 같은 도메인의 `stats.json`에서 읽습니다. 설치 파일 다운로드 요청과
실제 설치·활성 사용자를 구분합니다. 설치 완료 수와 활성 사용자 수는 아직 미측정(`null`)입니다.
GitHub 다운로드에서 사람이나 CI 비율을 추정해서 차감하지 않습니다.

- `.github/scripts/metrics-data.mjs`: 포함 확장자·검증·페이지 순회·합산 정의.
- `.github/scripts/build-stats.mjs`: 공개 원본을 조회하고 `stats.json`과
  `metrics/snapshots/<관측시각>.json`을 함께 기록합니다.
- `metrics/index.html`: 한국어·영어 지표 정의, 한계, 이전 설치 수 표기의 정정.
- `.github/workflows/stats.yml`: 검증 통과 후 기록합니다. 조회 오류는 이전 관측을 유지합니다.

```bash
node --test .github/scripts/metrics-data.test.mjs
node .github/scripts/build-stats.mjs stats.json index.html
node build-seo.mjs
```

스냅샷은 공개 릴리스 자산의 ID·파일명·카운터·관측 시점만 담습니다. 요청자의 IP·계정·
사용 내용은 수집하지 않습니다. 기록 이전의 상세 내역은 소급해서 만들지 않습니다.
원본 누계는 삭제·재업로드·상류 집계 조정으로 줄어들 수도 있습니다.

## 런타임과 방문자 데이터

폰트와 React 런타임은 사이트에서 직접 서빙합니다. 홈페이지는 조회를 위해 방문자
브라우저에서 GitHub API를 호출하지 않으며 외부 방문자 카운터를 사용하지 않습니다.
언어 선택과 스키마 버전이 일치하는 공개 지표 캐시만 로컬 브라우저에 보존합니다.
설치·활성 사용자·광고 도달 인원으로 해석할 수 있는 검증된 방문자 지표는 없습니다.

## 배포

GitHub Pages 로 서빙합니다. 저장소 Settings → Pages 에서 브랜치(`main`) / 폴더(`/`)를
지정하면 됩니다. Custom domain 은 저장소 루트의 `CNAME` 파일로 이미 지정돼 있으므로
Pages 설정 화면에서 따로 입력하지 않아도 됩니다.

도메인은 **`vibisual.pro`** 이고, 저장소 루트의 `CNAME` 에 적혀 있습니다.
`index.html` 의 `canonical` · `og:url` · `og:image` · `twitter:image` 도 같은 주소를 가리킵니다 —
도메인을 바꾸면 이 다섯 곳을 함께 고쳐야 공유 카드가 제 주소를 가리킵니다.

> DNS 는 apex(`vibisual.pro`)를 GitHub Pages 의 A 레코드 네 개로 향하게 해야 합니다.
> `185.199.108.153` · `185.199.109.153` · `185.199.110.153` · `185.199.111.153`
> (`www` 를 쓸 거라면 CNAME 을 `vibisual.github.io` 로.)
