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

## 런타임 의존성

`support.js` 가 실행 시점에 unpkg 에서 아래를 내려받습니다. 셋 다 버전을 고정하고
`integrity`(sha384 SRI)를 걸어 두었으므로, 파일이 바뀌면 로드되지 않고 실패합니다.

- `react@18.3.1` (UMD, production)
- `react-dom@18.3.1` (UMD, production)
- `@babel/standalone@7.29.0`

즉 **브라우저에서 JSX 를 컴파일하는 구조**라 첫 화면까지 내려받을 용량이 크고,
unpkg 가 흔들리면 페이지가 렌더링되지 않습니다. 상시 서비스 단계에서는 이 세 개를
저장소에 자체 호스팅하거나 정적 산출물로 프리렌더하는 쪽을 검토해야 합니다.

웹폰트는 **자체 호스팅**입니다(`fonts/`). Google Fonts 를 직접 부르면 방문자 IP 가
Google 로 나가므로, CSS 와 woff2 를 받아 이 저장소에서 서빙합니다.

## 방문자 데이터

분석 도구도 쿠키도 쓰지 않습니다. 브라우저에 남는 것은 고른 언어(`vibisual-lang`)
하나뿐이고, 바깥으로 나가는 요청은 위 unpkg 세 개와 GitHub 공개 API(별 수 · 릴리스
다운로드 수 조회)뿐입니다. 페이지 하단에 같은 내용을 12개 언어로 적어 두었습니다.

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
