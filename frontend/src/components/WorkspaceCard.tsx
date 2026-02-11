import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Workspace } from "@/types";

interface WorkspaceCardProps {
  workspace: Workspace;
  onDelete: (id: string) => void;
}

export default function WorkspaceCard({ workspace, onDelete }: WorkspaceCardProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{workspace.name}</CardTitle>
          <Badge variant={workspace.status === "running" ? "default" : "secondary"}>
            <span
              className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                workspace.status === "running" ? "bg-green-400" : "bg-muted-foreground/40"
              }`}
            />
            {workspace.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-2">
        <p className="text-sm text-muted-foreground">{workspace.branch}</p>
        <p className="text-xs text-muted-foreground">
          {workspace.agents.length} agent{workspace.agents.length !== 1 ? "s" : ""}
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm" onClick={() => navigate(`/workspaces/${workspace.id}`)}>
          Open
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDelete(workspace.id)}
        >
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
}
