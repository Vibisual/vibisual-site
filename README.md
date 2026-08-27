# vibisual — landing site

[Vibisual](https://github.com/Vibisual/vibisual) 랜딩 페이지의 소스입니다.

## 구성

| 파일 | 역할 |
|---|---|
| `Vibisual.dc.html` | 페이지 전체(마크업 · 스타일 · 배경 캔버스 · 문안). 단일 파일입니다. |
| `support.js` | `dc-runtime` 빌드 산출물. `<x-dc>` 템플릿을 읽어 브라우저에서 렌더링합니다. |
| `screenshots/` | 페이지에서 쓰는 이미지 |

## 로컬에서 보기

`file://` 로 열면 브라우저 보안 정책에 걸리므로 정적 서버로 띄웁니다.

```bash
npx serve .
# 또는
python -m http.server 8080
```

열고 나서 `Vibisual.dc.html` 로 이동하면 됩니다.

## 런타임 의존성

`support.js` 가 실행 시점에 unpkg 에서 아래를 내려받습니다.

- `react@18.3.1` (UMD, production)
- `react-dom@18.3.1` (UMD, production)
- `@babel/standalone@7.29.0`

즉 **브라우저에서 JSX 를 컴파일하는 구조**라 첫 화면까지 내려받을 용량이 크고,
unpkg 가 흔들리면 페이지가 렌더링되지 않습니다. 도메인을 붙여 상시 서비스할
단계에서는 이 세 개를 저장소에 자체 호스팅하거나 정적 산출물로 프리렌더하는
쪽을 검토해야 합니다.

## 배포

GitHub Pages 로 서빙하고 구매한 도메인을 CNAME 으로 연결합니다.
저장소 Settings → Pages 에서 브랜치(`main`) / 폴더(`/`)를 지정하고,
Custom domain 에 도메인을 넣으면 저장소 루트에 `CNAME` 파일이 생성됩니다.
