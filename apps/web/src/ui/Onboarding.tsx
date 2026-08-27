import { useEffect, useState } from 'react';
import { track } from '../analytics/track';
import { markOnboardingSeen } from '../onboarding/onboardingState';

interface Step {
  title: string;
  text: string;
  emoji: string;
}

const STEPS: Step[] = [
  {
    emoji: '🌱',
    title: 'Добро пожаловать в Genesis Garden',
    text: 'Это маленький сад-питомник: сажай семена, собирай урожай и выращивай коллекцию уникальных растений.',
  },
  {
    emoji: '🪴',
    title: 'Посади и собери',
    text: 'Нажми на пустую грядку, выбери семя из инвентаря — а когда оно вырастет, собери урожай нажатием на грядку ещё раз.',
  },
  {
    emoji: '🧪',
    title: 'Скрещивай в лаборатории',
    text: 'Выбери двух собранных особей в «Лаборатории» — получишь новое растение со случайными генами родителей и шансом на редкую мутацию.',
  },
  {
    emoji: '🎯',
    title: 'Цели подскажут, что делать',
    text: 'Кнопка «Цели» всегда показывает следующую простую задачу с наградой — если не знаешь, чем заняться, загляни туда.',
  },
];

interface OnboardingProps {
  onFinish: () => void;
}

export function Onboarding({ onFinish }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  useEffect(() => {
    track('tutorial_started');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish(completed: boolean) {
    markOnboardingSeen();
    // Честно: завершением считаем только полный проход до конца, не пропуск.
    if (completed) track('tutorial_completed');
    onFinish();
  }

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-card">
        <button className="onboarding-skip" onClick={() => finish(false)}>
          Пропустить
        </button>
        <div className="onboarding-emoji" aria-hidden="true">
          {current.emoji}
        </div>
        <h2 className="onboarding-title">{current.title}</h2>
        <p className="onboarding-text">{current.text}</p>
        <div className="onboarding-dots">
          {STEPS.map((s, i) => (
            <span key={s.title} className={`onboarding-dot ${i === step ? 'is-active' : ''}`} />
          ))}
        </div>
        <button
          className="sheet-buy-btn onboarding-next"
          onClick={() => {
            if (isLast) finish(true);
            else setStep((s) => s + 1);
          }}
        >
          {isLast ? 'Начать играть' : 'Далее'}
        </button>
      </div>
    </div>
  );
}
