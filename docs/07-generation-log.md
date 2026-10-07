# 이미지 생성 프롬프트·이력

2026-09-20 작성. 내장 `image_gen` 도구로 PNG 5장을 생성했다. CLI/API 폴백은 사용하지 않았다. 캐릭터명은 사용자가 확정한 온이름·피자럭스를 적용했다.

온이름의 첫 로컬 JPEG 참조 호출은 invalid_image_file 오류가 발생했다. 이미 대화에 표시한 원본 메모를 최근 이미지 1장으로 참조하여 재시도했고 성공했다. 나머지 캐릭터는 직접 판독한 외형을 텍스트로 전달했다. 아래는 각 성공 호출의 최종 프롬프트다.

## earth-arrow

- 저장: `assets/characters/earth-arrow.png`
- 생성 원본: `/Users/pc/.codex/generated_images/01a0be7b-ca53-75a3-9df2-3bcc3c94dd9a/exec-5a204127-96ab-481e-bc68-1b9104cddf23.png`
- 참조: 대화 내 IMG_5071.jpg (`num_last_images_to_include: 1`)

```text
Use case: stylized-concept. Asset type: single transparent full-body 2D web game character sprite. Reference image: the provided hand-drawn character memo IMG_5071.jpg, use ONLY the upper-left character as design reference. Faithfully refine that original child's character: oversized round pale face encircled by blue hair/hood, prominent long blue arrow projecting diagonally up-left from head, black sunglasses, cheerful small open red mouth, black business suit, white shirt, blue tie, holding one stylized assault rifle pointing right. Chibi proportions, bold dark clean outlines, flat colors with minimal cel shading, playful hand-drawn personality. Single neutral ready standing pose, three-quarter front view facing right, entire arrow, feet and gun contained with generous margin. Actual transparent background, no shadow ground, no text, no labels, no other characters, no gore. Square canvas.
```

## earth-pizza

- 저장: `assets/characters/earth-pizza.png`
- 생성 원본: `/Users/pc/.codex/generated_images/01a0be7b-ca53-75a3-9df2-3bcc3c94dd9a/exec-85fcdfb1-5381-434b-9721-f7ee7c413589.png`
- 참조: 텍스트 프롬프트, 첨부 참조 없음

```text
Use case: stylized-concept. Asset type: single transparent full-body 2D web game character sprite. Design transcribed from the user's hand-drawn memo. Preserve yellow round face, triangular yellow pizza-slice hat with red pepperoni and reddish crust band, black sunglasses, cheerful red open mouth, black business suit, white shirt, yellow tie. Holds one chunky stylized machine gun pointing right (not a pistol). Chibi proportions, bold dark clean outlines, flat colors, minimal cel shading, playful original drawing personality. Single neutral ready standing pose, three-quarter front view facing right. Entire hat, feet and gun with generous margin. Actual transparent background, no ground shadow, no text, no labels, no other characters, no gore. Square canvas.
```

## isb-agent-1

- 저장: `assets/characters/isb-agent-1.png`
- 생성 원본: `/Users/pc/.codex/generated_images/01a0be7b-ca53-75a3-9df2-3bcc3c94dd9a/exec-c58023d1-3c81-4415-bc0d-7acb03463c15.png`
- 참조: 텍스트 프롬프트, 첨부 참조 없음

```text
Use case: stylized-concept. Asset type: single transparent full-body 2D web game character sprite. Design transcribed from the user's hand-drawn memo. Preserve oversized round warm light skin face, spiky swept-up black hair, black sunglasses, confident small smile, black business suit, white shirt, black tie, two stylized pistols, one in each hand, one angled up-right and other across body pointing right. Chibi proportions, bold dark clean outlines, flat colors, minimal cel shading, playful original drawing personality. Single neutral ready standing pose, three-quarter front view facing right, entire hair feet and both guns with generous margin. Actual transparent background, no ground shadow, no text, no labels, no other characters, no gore. Square canvas.
```

## isb-agent-2

- 저장: `assets/characters/isb-agent-2.png`
- 생성 원본: `/Users/pc/.codex/generated_images/01a0be7b-ca53-75a3-9df2-3bcc3c94dd9a/exec-8f097843-e676-4538-84e7-4d21d375a268.png`
- 참조: 텍스트 프롬프트, 첨부 참조 없음

```text
Use case: stylized-concept. Asset type: single transparent full-body 2D web game character sprite. Design transcribed from the user's hand-drawn memo. Preserve oversized round warm light skin face, straight side-parted black hair with long side fringe, black sunglasses, confident small smile, black business suit, white shirt, black tie, holding stylized red-brown RPG launcher across body with clearly green pointed rocket nose facing right. Chibi proportions, bold dark clean outlines, flat colors, minimal cel shading, playful original drawing personality. Single neutral ready standing pose, three-quarter front view facing right, entire hair feet and launcher with generous margin. Actual transparent background, no ground shadow, no text, no labels, no other characters, no gore. Square canvas.
```

## arena

- 저장: `assets/backgrounds/arena.png`
- 생성 원본: `/Users/pc/.codex/generated_images/01a0be7b-ca53-75a3-9df2-3bcc3c94dd9a/exec-7dd8ad0c-1880-49d7-a77e-046580cb25da.png`
- 참조: 텍스트 프롬프트, 첨부 참조 없음

```text
Use case: stylized-concept. Asset type: landscape 3:2 background plate for a playful two-team web shooting game based on a child's notebook plan. Light warm off-white notebook paper texture, very subtle pencil grain, thin dark hand-drawn horizontal rail at 14 percent canvas height and another at 86 percent height, each runs from 5 percent to 95 percent width with small bidirectional arrow ends. Huge uncluttered empty central arena. Preserve minimalist paper sketch character, clean enough for contrasting sprites. No characters, no weapons, no buildings, no obstacles, no UI, no letters or numbers, no score, no watermark. Flat orthographic 2D graphic background, full bleed opaque.
```

## 검사와 한계

생성 이미지 다섯 장을 시각적으로 확인했다. 네 캐릭터의 주요 장식·무기와 전신 구도를 확인했으며, 최종 파일의 PNG 구조·알파 값은 별도로 검사했다. 정적 포즈이며 애니메이션과 분리 파츠는 없다. 배경 레일은 생성 과정에서 요청한 14%/86%와 조금 달라 실제 그림 기준 약 11.5%/86.5%에 맞춰 기술 문서를 조정했다. 앵커는 육안 기준 초기값이므로 런타임 디버그 링으로 최종 튜닝한다.

## 코드네임 X·V·R, 시리우스 K (지구방위팀 요원)

- 저장: `assets/characters/codename-x.png`, `codename-v.png`, `codename-r.png`, `sirius-k.png` (1024×1024, 투명 배경)
- 원본: 사용자가 대화로 준 캐릭터 소개 그림 4장. 사용자가 "써도 되는 이미지"라고 사용을 허락했다. 원본 그림 파일은 저장소에 넣지 않았다.
- 이미지 생성 모델은 쓰지 않았다. 다음 순서로 손질했다.
  1. 배경 제거: `rembg`의 `isnet-anime` 모델.
  2. 무기: 만화풍 돌격소총·권총·저격총을 Pillow로 직접 그려(검은 외곽선, 어두운 회색 몸체) 손 위치에 돌려 붙이고, 손 부분은 원본 픽셀을 다시 덮어 쥔 것처럼 보이게 했다.
  3. 코드네임 X는 스케이트보드를 지웠고, 코드네임 V는 브이 하던 손가락을 지우고 위로 든 권총(슬라이드)을 두 주먹에 쥐였다.
  4. 시리우스 K는 원래 권총을 든 그림이라 무기는 그대로 두고, 그림 위에 겹친 이미지 검색 아이콘을 지운 뒤 다리 부분을 주변 색으로 메웠다(OpenCV inpaint). 게임 그림은 오른쪽을 보게 좌우 반전했다.
  5. 그림판 아래쪽에 발이 오게 키 975px로 맞추고 가운데 정렬했다. 시리우스 K는 원본 그림에서 발끝이 잘려 있어 무릎 아래가 그림판 끝에서 잘린다.
