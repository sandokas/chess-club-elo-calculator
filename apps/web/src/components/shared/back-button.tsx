import { Button } from "@/components/ui/button.js";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function BackButton() {
  const navigate = useNavigate();
  
  return (
    <Button 
      variant="ghost" 
      size="sm" 
      onClick={() => navigate(-1)}
      aria-label="Go back to previous page"
    >
      <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
      Back
    </Button>
  );
}
