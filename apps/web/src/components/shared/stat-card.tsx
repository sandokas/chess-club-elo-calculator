import { Card, CardContent } from "@/components/ui/card.js";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
}

export function StatCard({ label, value }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <strong className="text-2xl">{value}</strong>
      </CardContent>
    </Card>
  );
}
