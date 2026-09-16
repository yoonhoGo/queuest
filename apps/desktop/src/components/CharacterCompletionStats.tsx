import { StatCard } from "./ui";

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
        <StatCard icon={icon} label={label} value={count} key={icon} />
      ))}
    </div>
  );
}
