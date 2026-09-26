# HAHA 2 Shoot — 웹앱 게임 제작 패키지

두 장의 손그림 메모를 바탕으로 작성한 기획·개발 문서, 게임 에셋, 그리고 이를 구현한 로컬 2인/4인 웹 게임입니다. 게임명은 저장소 이름에서 가져온 **가칭**입니다.

## 실행

빌드·의존성 없는 정적 웹앱(ES 모듈 + Canvas 2D)입니다. ES 모듈은 `file://`에서 열리지 않으므로 정적 서버로 엽니다.

```sh
npm start        # python3 -m http.server 8000 → http://localhost:8000
npm test         # node --test, 이동·조준·발사·무기 전환·총기 피해·체력·엄폐물·드론·전투기 로직 검증
```

코드 구조는 [웹앱 기술 설계](docs/04-technical-design.md)의 `src/` 계약을 따릅니다(`.ts` 대신 `.js`). 기획 대비 단순화한 점: 키 재배정 UI 없음, 준비 화면은 슬롯별 준비 표시 대신 시작 버튼 하나, 터치와 키보드는 모든 슬롯에서 항상 함께 받습니다. 실제 터치 기기에서의 다중 접점·성능 검수(docs/06 "실제 기기에서 확인")는 아직 수행하지 않았습니다.

## 문서 읽는 순서

1. [원본 메모 해독과 요구사항](docs/01-source-notes.md)
2. [게임 기획서](docs/02-game-design.md)
3. [화면·입력·사용자 흐름](docs/03-ux-and-controls.md)
4. [웹앱 기술 설계](docs/04-technical-design.md)
5. [아트 가이드·에셋 명세](docs/05-art-and-assets.md)
6. [개발 일정·검수 기준](docs/06-development-and-qa.md)
7. [이미지 생성 프롬프트·이력](docs/07-generation-log.md)

## 핵심 게임

지구방위팀과 ISB팀이 **건물 옥상**의 상·하단 레일에서 좌우(X축)로만 이동하며 대결합니다. 조준 스틱을 드래그해 경기장 안쪽 180도를 조준하면 **누르고 있는 동안 자동으로 발사**됩니다. 모든 플레이어는 **체력 500**으로 시작하며, 캐릭터 아래와 오른쪽 팀 패널에 체력바가 표시됩니다. 체력이 0이 되면 쓰러지고, **상대 팀을 모두 쓰러뜨리면 승리**합니다(같은 순간 양 팀 전멸은 무승부). 아군 공격은 불가능합니다.

경기 전 준비 화면에서 자리(P1·P3 지구방위팀, P2·P4 ISB팀)마다 **캐릭터 5명 중 하나와 주무기를 고릅니다.** 주무기는 경기 중에 바꿀 수 없습니다. 경기 중에는 자기 패널의 무기 전환 버튼(키보드: P1 `E`, P2 오른쪽 `Shift`, P3 `U`, P4 `Num+`)으로 **주무기 → 보조무기 → 수류탄 → 주무기** 순으로 전환합니다. 전환 직후 0.4초 동안은 쏠 수 없습니다.

기본 선택은 그림 속 무기와 같습니다: 온이름 쌍권총, 요원 1 권총, 피자럭스 돌격소총, 요원 2 RPG.

**주무기**

| 총기 | 발사 방식 | 한 발 피해 |
| --- | --- | --- |
| 돌격소총 | 누르고 있으면 0.2초마다 | 7 |
| 권총 | 누르고 있으면 0.5초마다 | 10 |
| 쌍권총 | 누르고 있으면 0.5초마다 2점사 | 10 |
| RPG | 조준한 뒤 **손을 떼면** 한 발, 발사 후 쿨타임 1초 (탄속 900, 유도) | 직접 명중 40, 폭발 범위(주변 적) 4 |
| 저격총 | 누르고 있으면 1.5초마다 (탄속 1600, 긴 조준선) | 60 |

**보조무기·수류탄** (드론 R-4는 쓸 수 없음)

| 무기 | 발사 방식 | 피해 |
| --- | --- | --- |
| 기관단총(보조무기) | 누르고 있으면 0.1초마다. 4초 연속으로 쏘면 과열되어 2초 동안 쏠 수 없음. 쉬는 동안엔 식음 | 한 발 4 |
| 수류탄 | 조준한 뒤 **손을 떼면** 던짐. 엄폐물·사람 위로 날아가 적 레일 선에서 폭발. 던진 뒤 쿨타임 20초(무기를 바꿔도 흐름) | 반경 240(RPG의 2배) 안의 적 모두 50, 엄폐물도 깎음 |

**드론 R-4**: 아래에 카메라, 앞에 레이저 발사기 2개가 달린 드론입니다. 주무기는 **레이저 캐논**만 쓰고 보조무기·수류탄은 없습니다. 레이저 캐논은 누르고 있으면 0.1초마다 붉은 레이저가 즉시 뻗어 처음 닿는 적에게 5 피해를 줍니다(엄폐물·전투기에 막히며 엄폐물을 깎음). 쏠 때마다 배터리가 닳아 30발(3초)을 쏘면 방전되고, 마지막으로 쏜 뒤 2초가 지나면 배터리가 가득 찹니다. 캐릭터 아래 막대로 배터리(빨강)·기관단총 열(주황)·수류탄 쿨타임(회색)을 보여 줍니다.

RPG는 가장 가까운 적 쪽으로 휘어 날아가며(초당 최대 약 46°, 약하게), 빗나가도 적 레일 선·경기장 끝·수명 끝에서 반드시 터져 주변에 폭발 피해를 줍니다.

경기장(1600×1000)에는 **엄폐물 3개**가 있습니다. 가운데 1개와 각 팀 진영 앞에 1개씩(점대칭 배치)이며, 양 팀 총알을 막고 RPG는 엄폐물에 닿으면 그 자리에서 폭발합니다. 엄폐물은 **내구도 200**이며 양 팀 총알(한 발 피해만큼), RPG 직격(2배, 80), RPG 폭발 범위(4)에 깎입니다. 전투기 미사일은 엄폐물 위로 넘어가므로 막히지도 깎지도 않습니다. 깎일수록 금이 가고 위에 내구도 바가 뜨며, 0이 되면 부서져 그 경기 동안 다시 생기지 않습니다.

가끔 **전투기**가 무작위로 나타나 경기장 가운데를 가로로 지나갑니다. 전투기는 양 팀 총알을 모두 막아 주며(RPG는 그 자리에서 폭발), 화면 안에 있는 동안 **1초마다 위·아래 양방향으로 미사일**을 쏴서 양 팀 모두를 공격합니다. 미사일은 직격 20에 주변 폭발 피해 8(반경 120)이고, 유도 없이 똑바로 날아가며, 엄폐물을 넘어가 플레이어에게 직접 날아갑니다. 빗나가면 목표 레일 선에서 터집니다. 전투기가 지나가는 동안 위치에 따라 좌우로 움직이는 엔진 소리가 나고, 총을 쏠 때마다 총기별 총성이 납니다. 수치는 [`src/game/config.js`](src/game/config.js)의 `WEAPONS`·`JET`·`COVERS`·`COVER`에서 조정합니다. 두 번째 손글씨 메모(무기표·체력·자동 발사·옥상·전투기)를 반영한 업그레이드이며, 이전 버전의 "10점 선취" 규칙은 체력제로 바뀌었습니다.

메모의 직접 요구사항은 **[원문]**, 사용자가 바로잡은 이름은 **[확정]**, 개발을 위해 추가한 내용은 **[제안]**으로 문서에서 구분합니다. 제안값은 플레이테스트를 통해 조정합니다.

## 파일

- 원본: `IMG_5070.jpg`, `IMG_5071.jpg`, 업그레이드 메모 `upgrade-memo.jpg` (개인 메모라 저장소에 포함하지 않음)
- 캐릭터: [assets/characters](assets/characters)
- 배경: [assets/backgrounds](assets/backgrounds) (경기에는 `rooftop.svg` 사용)
- UI·효과: [assets/ui](assets/ui), [assets/effects](assets/effects) (전투기 `fighter-jet.svg` 포함)
- 에셋 목록 및 실제 크기: [assets/manifest.json](assets/manifest.json)
- 브라우저 미리보기: [assets/preview.html](assets/preview.html) 파일을 브라우저로 열기

### 무기별 캐릭터 그림

지금 캐릭터 그림은 캐릭터마다 한 장이며 기본 주무기가 그려져 있어(온이름 쌍권총, 요원 1 권총, 피자럭스 돌격소총, 요원 2 RPG, R-4 레이저 발사기), 무기를 바꿔도 모습은 그대로입니다. 온이름·요원 1 그림은 원래 그림을 편집해 만들었습니다(온이름 머리 + 요원 1의 쌍권총 든 몸, 넥타이는 파랑 / 요원 1은 들어 올린 권총을 지움). R-4는 직접 그린 SVG입니다. 무기별 그림을 넣으면 든 무기에 따라 모습이 바뀝니다.

1. `assets/characters/<캐릭터 id>@<무기 id>.png` 로 저장합니다. 예: `earth-arrow@sniper.png`
   - 캐릭터 id: `earth-arrow`, `earth-pizza`, `isb-agent-1`, `isb-agent-2`
   - 무기 id: `rifle`, `pistol`, `dual`, `rpg`, `sniper`, `smg`, `grenade`
   - 기존 그림처럼 정사각형·투명 배경·오른쪽을 보는 자세로 맞추면 됩니다.
2. `assets/manifest.json`의 `assets`에 항목을 추가합니다. `id`는 파일 이름과 같은 `<캐릭터 id>@<무기 id>`, `bodyAnchor`는 몸 중심 위치(0~1 비율)입니다. 기존 캐릭터 항목을 복사해 `id`·`path`만 바꾸면 됩니다.

그림이 없는 조합은 기본 그림을 그대로 씁니다. `assets` 폴더는 통째로 배포되므로 워크플로 수정은 필요 없습니다.

캐릭터 이미지는 정적 완성 포즈입니다. 움직이는 팔·총의 분리 파츠나 프레임 애니메이션 시트는 포함하지 않으며, MVP에서는 별도 조준선과 간단한 전체 스프라이트 변형으로 동작을 표현합니다.

## 배포 (GitHub Pages)

주소: https://umid-podo.github.io/hahaha-shoot-001/

`main`에 push하면 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)이 게임 실행에 필요한 파일만 모아 배포한다. 문서와 테스트는 사이트에 올라가지 않는다. 게임이 새 파일이나 폴더를 쓰게 되면 워크플로의 `Collect game files` 단계에도 추가한다. 빠뜨리면 사이트에서 404가 난다.

### Claude Code Cloud에서 배포

"배포해줘"라는 요청을 받으면 아래 순서대로 진행한다. 클라우드 세션은 자기 작업 브랜치에만 push할 수 있으므로 PR로 `main`에 반영한다.

1. 테스트: `npm test`.
2. 변경 사항을 커밋하고 작업 브랜치를 push한다.
   ```sh
   git push -u origin HEAD
   ```
3. PR을 만들고 병합한다. 병합되면 `main` push로 배포가 자동으로 시작된다. 이미 열린 PR이 있으면 새로 만들지 않고 그 PR을 병합한다.
   ```sh
   gh pr create --repo umid-podo/hahaha-shoot-001 --base main --fill
   gh pr merge --repo umid-podo/hahaha-shoot-001 --merge
   ```
4. 병합이 막히면 작업 브랜치를 바로 배포한다. `github-pages` 환경은 `main`과 `claude/*` 브랜치의 배포만 허용한다.
   ```sh
   gh workflow run deploy-pages.yml --repo umid-podo/hahaha-shoot-001 --ref "$(git branch --show-current)"
   ```
   이 경우 `main`에는 아직 반영되지 않았으므로 사용자에게 PR 병합을 요청한다. 병합하지 않으면 다음 `main` 배포가 이 변경을 덮어쓴다.
5. 배포 실행이 끝날 때까지 기다린다. 실행 목록에 바로 보이지 않으면 몇 초 뒤 다시 조회한다.
   ```sh
   gh run list --repo umid-podo/hahaha-shoot-001 --workflow deploy-pages.yml --limit 1
   gh run watch <실행 ID> --repo umid-podo/hahaha-shoot-001 --exit-status
   ```
6. 사이트가 `200`을 돌려주는지 확인하고 주소를 사용자에게 알린다. 클라우드 네트워크에서 `github.io`에 접속할 수 없으면 5번의 성공 결과로 대신하고, 그렇게 보고한다.
   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://umid-podo.github.io/hahaha-shoot-001/
   ```

### 로컬에서 배포

`main`에서 커밋하고 `git push`하면 된다. 확인은 위 5~6번과 같다.

### 처음 설정 (완료됨)

저장소 Settings → Pages의 Source는 **GitHub Actions**이고, Settings → Environments → `github-pages`의 배포 브랜치는 `main`, `claude/*`로 제한되어 있다. Pages 설정이 꺼졌다면 아래 명령으로 다시 켠다.

```sh
gh api -X POST repos/umid-podo/hahaha-shoot-001/pages -f build_type=workflow
```

배포 브랜치 제한이 사라졌다면 아래 명령으로 되살린다. 마지막 줄이 `claude/*,main`을 출력하면 된다.

```sh
echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' | gh api -X PUT repos/umid-podo/hahaha-shoot-001/environments/github-pages --input -
gh api -X POST repos/umid-podo/hahaha-shoot-001/environments/github-pages/deployment-branch-policies -f name=main -f type=branch
gh api -X POST repos/umid-podo/hahaha-shoot-001/environments/github-pages/deployment-branch-policies -f name='claude/*' -f type=branch
gh api repos/umid-podo/hahaha-shoot-001/environments/github-pages/deployment-branch-policies --jq '[.branch_policies[].name]|join(",")'
```
