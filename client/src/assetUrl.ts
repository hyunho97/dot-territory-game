/**
 * 정적 파일(이미지/소리/매니페스트) 주소. 사이트가 하위 경로(예: GitHub Pages 의 /저장소이름/)에 올라가도
 * 동작하도록 빌드 설정의 base 를 앞에 붙인다.
 */
export const assetUrl = (path: string): string =>
  import.meta.env.BASE_URL + path.replace(/^\//, '');
