# 웹앱 기술 설계

본 문서는 구현 계약 **제안**이며 현재 게임 코드가 구현됐다는 뜻은 아니다. 특정 라이브러리의 최신 버전에 의존하지 않도록 브라우저 Canvas 2D, DOM, Pointer Events를 기준으로 한다.

## 구성

첫 버전은 정적 웹앱으로 배포할 수 있는 로컬 게임이다. TypeScript를 사용할 수 있으며 빌드 도구와 버전은 구현 착수 때 고정한다. 로그인·백엔드·외부 API는 필요하지 않다. 게임의 논리 상태는 렌더링과 분리한다.

```text
src/
  game/config.ts        # 논리 크기, 탄속, 쿨다운
  game/state.ts         # 상태와 슬롯
  game/update.ts        # 고정 틱 업데이트
  game/collision.ts     # 연속 충돌, 팀 필터
  input/pointer.ts      # 포인터 소유권과 취소
  input/keyboard.ts     # 키 매핑과 발사 엣지
  render/canvas.ts      # 이미지, 조준선, 효과
  ui/screens.ts        # 메뉴, 준비, 결과, 접근성
  audio/synth.ts        # 짧은 합성 효과음
  storage/settings.ts  # 음소거, 키 매핑, 동작 줄이기
assets/                # 현재 생성된 이미지·SVG
```

## 데이터 계약

```ts
type Team = 'earth' | 'isb';
type Phase = 'menu' | 'ready' | 'countdown' | 'playing' | 'paused' | 'result';
type CharacterId = 'earth-arrow' | 'earth-pizza' | 'isb-agent-1' | 'isb-agent-2';
interface Player {
  id: string; team: Team; characterId: CharacterId;
  x: number; y: number; aim: number;
  cooldown: number; invulnerable: number;
}
interface InputFrame {
  playerId: string; moveAxis: number; aim: number;
  fireReleased: boolean; // 1틱 소비 후 반드시 false로 초기화
}
interface Projectile {
  id: number; ownerId: string; team: Team;
  x: number; y: number; previousX: number; previousY: number;
  vx: number; vy: number; life: number;
}
interface Match {
  phase: Phase; players: Player[]; projectiles: Projectile[];
  scores: Record<Team, number>; tick: number;
  winner: Team | 'draw' | null;
}
```

`CharacterId`는 에셋 manifest의 ID와 일치한다. 표시 이름은 별도 매핑하며 이름 정정으로 코드 ID를 바꾸지 않는다. 설정은 `haha2.settings.v1` 키로 로컬에 저장하고 JSON 파싱 실패·저장 불가 시 기본값으로 실행한다. 진행 중 경기는 저장하지 않는다.

## 좌표·조준

경기장 논리 크기 1200×800, 상단 y=92, 하단 y=692. Canvas의 +X는 오른쪽, +Y는 아래쪽. 상단 각도는 `[0, π]`, 하단 각도는 `[-π, 0]`. 초기 방향은 상단 `π/2`, 하단 `-π/2`.

포인터 CSS 좌표는 경기장 사각형의 좌상단과 scale을 반영해 논리 좌표로 환산한다. DPR은 backing buffer에만 적용하고 물리 계산에는 적용하지 않는다. 최대 렌더 DPR 2를 제안한다. 터치 패널의 드래그 방향은 패널 중심에 대한 CSS 벡터이므로 경기장 오프셋을 섞지 않는다.

스프라이트는 최대 128×128 안에서 원본 비율로 표시한다. 캐릭터별 몸 중심 앵커는 manifest의 `bodyAnchor`를 사용하며 물리 위치 `(x,y)`에 맞춘다. 탄환은 몸 중심에서 조준 벡터 방향으로 38px 떨어진 지점에 생성한다. 현재 이미지의 총은 고정 자세이므로 총구와 실제 발사 지점이 정확히 일치하지 않는다. 조준선·몸 중심 링으로 방향을 표시하는 MVP 계약이며, 정교한 총 회전은 분리 파츠 제작 이후 구현한다.

## 고정 업데이트

`requestAnimationFrame`으로 그리되 논리는 1/60초 간격으로 업데이트한다. 긴 프레임의 누적 시간은 100ms로 제한하고 프레임당 최대 6회 처리한다. 숨김 상태에서는 누적 시간을 버리고 일시정지한다.

1. playing 여부 확인, 입력 스냅샷 수집.
2. 쿨다운·무적 시간 감소, 캐릭터 X 이동 후 경계 제한.
3. 발사 엣지와 쿨다운 확인 → 탄환 생성 → 해당 엣지 소비.
4. 탄환 이전·현재 위치 계산, 상대와 연속 충돌 검사.
5. 적중 이벤트 수집, 피해자별 같은 틱 중복을 제거.
6. 유효 이벤트당 팀 +1, 피해자 무적 적용, 관련 탄환 제거.
7. 수명 종료·경기장 밖 탄환 제거.
8. 점수 최대 10으로 제한한 후 두 팀 모두 10이면 draw, 한 팀만 10이면 승리.
9. 결과 진입 시 남은 발사 입력·탄환 제거 및 결과 UI 표시.

## 충돌 계약

탄환 반지름 5와 상대 몸 원 반지름 30을 합친 35px에 대해 선분–원 교차를 검사한다. 움직이는 대상에는 탄환의 이전/현재 좌표에서 대상의 이전/현재 좌표를 각각 빼서 **상대 운동 선분**으로 계산한다. 빠른 이동·낮은 FPS에서도 관통 누락이 없어야 한다.

아군/발사자와의 교차는 검사에서 제외한다. 한 탄환이 여러 상대와 교차하면 가장 이른 접촉 하나만 처리한다. 전체 이벤트는 접촉 시간, 탄환 ID, 피해자 ID 순서로 정렬한다. 같은 피해자를 같은 틱에서 여러 발이 맞히면 첫 유효 이벤트만 득점하고 나머지 접촉 탄환도 제거한다. 틱 시작 때 무적이 남은 상대에 닿은 탄환도 제거하되 점수는 없다. 첫 득점 순간 즉시 결과로 전환하지 않아 반대 팀의 같은 틱 적중도 반영한다.

## 에셋 로딩·성능

필수 이미지와 manifest를 먼저 불러오고 decode 완료 후 준비 화면을 활성화한다. 실패 시 파일명과 다시 시도 버튼을 표시한다. 게임 중 네트워크 재요청은 하지 않는다. 이미지 한 장을 매 프레임 새로 생성하지 않는다. 동일 이미지를 공유하고 효과 객체는 짧은 수명을 갖는다.

목표는 대표 데스크톱·태블릿에서 60fps, 4인 5분 플레이 중 지속적인 메모리 증가 없음이다. 원본 PNG는 아트 마스터이며 전송 예산은 메타데이터에 기록한다. 배포 전 필요하면 별도 최적화 사본을 만들어 화질·알파를 비교하고 manifest 경로를 갱신한다. 현재 단계에서 압축 크기 목표를 달성했다고 가정하지 않는다.

## 온라인 확장 경계

온라인은 별도 개발 범위다. 추가할 때는 권위 서버가 위치·발사 쿨다운·충돌·점수를 계산하고 클라이언트는 입력만 전송한다. 룸 코드·슬롯 배정·준비·끊김·재연결·지연 보정이 필요하다. 현재 공유 화면 설계를 온라인이 완성된 것처럼 표시하지 않는다.
