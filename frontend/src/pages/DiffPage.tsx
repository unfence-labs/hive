import { useParams, useNavigate } from "react-router-dom";
import DiffViewer from "@/components/DiffViewer";
import { Button } from "@/components/ui/button";

export default function DiffPage() {
  const { wsId } = useParams();
  const navigate = useNavigate();

  if (!wsId) return null;

  return (
    <div className="p-6">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          &larr; Back
        </Button>
      </div>
      <h1 className="mb-4 text-2xl font-bold">Diff</h1>
      <DiffViewer
        wsId={wsId}
        onMerged={() => navigate("/")}
        onDiscarded={() => navigate("/")}
      />
    </div>
  );
}
