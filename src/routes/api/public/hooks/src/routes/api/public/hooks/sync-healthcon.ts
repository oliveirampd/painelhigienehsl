import { createFileRoute } from "@tanstack/react-router";

const HEALTHCON =
  "http://healthconprd/service/painelhigienizacao/pesquisar/1";

export const Route = createFileRoute("/api/public/hooks/sync-healthcon")({
  server: {
    handlers: {
      GET: async () => {

        const response = await fetch(HEALTHCON);

        if (!response.ok) {
          throw new Error("Erro ao consultar HealthCon");
        }

        const json = await response.json();

        return Response.json(json);

      },
    },
  },
});
