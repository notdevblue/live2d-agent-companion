import { SURPRISED_EXPRESSION, THINKING_MOTION } from '../shared/model-mappings.js';

// Display aliases only. Original manifest IDs/file names remain the saved mapping values.
const expressions: Record<string, string> = {
  [SURPRISED_EXPRESSION]: '놀람 (기본 표정)',
  体型1: '체형 1',
  体型2: '체형 2',
  兔牙: '토끼 앞니',
  前倾: '앞으로 기울이기',
  加载: '로딩 표시',
  单片眼镜: '외알 안경',
  圈圈眼: '빙글빙글 눈',
  尾巴开关: '꼬리 켜기·끄기',
  屑屑眼: '장난스러운 눈',
  流冷汗: '식은땀',
  流泪: '눈물',
  爱心眼: '하트 눈',
  竖食指关: '검지 포즈 해제',
  竖食指开: '검지 포즈 켜기',
  胸口衣服: '가슴 부분 의상',
  脱鞋: '신발 벗기',
  脸红: '홍조',
  裙子切换: '치마 전환',
  钢盆: '쇠대야',
  黑框眼镜: '검은 테 안경',
  黑脸: '얼굴 그림자',
  默认体型: '기본 체형',
  '＞＜': '눈 꼭 감기 (＞＜)',
};
const motions: Record<string, string> = {
  [THINKING_MOTION]: '생각 (기본 연기)',
  IDLE: '대기',
  举手切默认手: '든 손 → 기본 손',
  狗尾草切回默认手: '강아지풀 → 기본 손',
  狗尾草切换出来: '강아지풀 꺼내기',
  竖手指切出来动画: '검지 포즈 시작',
  竖手指切回默认: '검지 포즈 복귀',
  // This asset's action has not been visually identified; do not invent a meaning.
  脱捕: '특수 동작 (원문: 脱捕)',
  默认手切举手: '기본 손 → 손 들기',
};

export function modelAssetLabel(name: string, kind: 'expression' | 'motion'): string {
  const labels = kind === 'expression' ? expressions : motions;
  return Object.hasOwn(labels, name) ? labels[name]! : name;
}
