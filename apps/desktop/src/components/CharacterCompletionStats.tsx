import { PixelIcon } from "./PixelIcon";

interface CharacterCompletionStatsProps {
  readonly completedTaskCount: number;
  readonly completedMilestoneCount: number;
}

export function CharacterCompletionStats({
  completedTaskCount,
  completedMilestoneCount,
}: CharacterCompletionStatsProps) {
  const stats = [
    { icon: "clipboard", label: "완료한 퀘스트", count: completedTaskCount },
    { icon: "flag", label: "완료한 스테이지", count: completedMilestoneCount },
  ] as const;

  return (
    <div className="character-completion-stats">
      {stats.map(({ icon, label, count }) => (
        <div className="character-completion-stat" key={icon}>
          <PixelIcon name={icon} />
          <div>
            <p>{label}</p>
            <strong>{count}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}
