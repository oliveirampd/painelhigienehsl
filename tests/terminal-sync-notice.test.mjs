import { describeTerminalSyncNotice } from "../src/lib/terminalSyncNotice.ts";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const NOW = Date.parse("2026-11-05T15:30:00.000Z");
function health(status, ageSeconds = 30, extra = {}) {
  return {
    status,
    ageSeconds,
    checkedAt: new Date(NOW).toISOString(),
    ...extra,
  };
}

describe("aviso de sincronização do Terminal", () => {
  test("carregamento inicial é discreto e não implica falha", () => {
    const result = describeTerminalSyncNotice(null, NOW);
    expect(result.tone).toBe("checking");
    expect(result.banner).toBeNull();
  });

  test("sucesso e reconciliação em observação não exibem alerta grande", () => {
    for (const status of ["healthy", "reconciling"]) {
      const result = describeTerminalSyncNotice(health(status), NOW);
      expect(result.tone).toBe("healthy");
      expect(result.label).toBe("ao vivo");
      expect(result.banner).toBeNull();
    }
  });

  test("uma tentativa falha após confirmação recente produz apenas indicador discreto", () => {
    const result = describeTerminalSyncNotice(health("stale", 75), NOW);
    expect(result.tone).toBe("warning");
    expect(result.banner).toBeNull();
    expect(result.detail).toContain("1 min");
  });

  test("atraso persistente acima de 180s continua avisando na própria página", () => {
    expect(describeTerminalSyncNotice(health("stale", 180), NOW).banner).toBeNull();
    const overdue = describeTerminalSyncNotice(health("stale", 181), NOW);
    expect(overdue.tone).toBe("critical");
    expect(overdue.banner).toContain("Sem sincronização confirmada");
    expect(overdue.banner).toContain("Listo");
  });

  test("aviso passa ao estado crítico mesmo se a última resposta estiver em cache", () => {
    const checkedAt = new Date(NOW - 80_000).toISOString();
    const result = describeTerminalSyncNotice(health("stale", 120, {checkedAt}), NOW);
    expect(result.banner).not.toBeNull();
  });

  test("nenhum sucesso comprovado merece alerta importante", () => {
    const result = describeTerminalSyncNotice(health("stale", null), NOW);
    expect(result.banner).not.toBeNull();
  });

  test("divergência comprovada mantém alerta mesmo com sincronização recente", () => {
    const mismatch = describeTerminalSyncNotice(health("degraded", 18), NOW);
    expect(mismatch.banner).toContain("divergências");
    const staleAndDifferent = describeTerminalSyncNotice(health("stale", 20, {missingInDatabase: 1}), NOW);
    expect(staleAndDifferent.banner).not.toBeNull();
  });

  test("falha pontual do monitor não equivale a falha do Listo", () => {
    for (const monitorFailures of [1, 2]) {
      const result = describeTerminalSyncNotice(health("unavailable", 25, {monitorFailures}), NOW);
      expect(result.banner).toBeNull();
      expect(result.label).toBe("Monitor indisponível");
    }
    const persistent = describeTerminalSyncNotice(health("unavailable", 200, {monitorFailures: 3}), NOW);
    expect(persistent.banner).toContain("verificar a sincronização");
    expect(persistent.banner).not.toContain("falhou");
  });

  test("recuperação comprovada limpa o alerta", () => {
    const failed = describeTerminalSyncNotice(health("stale", 215), NOW);
    expect(failed.banner).not.toBeNull();
    const recovered = describeTerminalSyncNotice(health("healthy", 18), NOW);
    expect(recovered.banner).toBeNull();
    expect(recovered.label).toBe("ao vivo");
  });

  test("o Terminal usa a apresentação centralizada e o hook zera erros após sucesso", () => {
    const tv = readFileSync("src/routes/tv.tsx", "utf8");
    const hook = readFileSync("src/hooks/useTerminalSyncHealth.ts", "utf8");
    expect(tv).toContain("describeTerminalSyncNotice(syncHealth, now)");
    expect(tv).toContain("syncNotice.banner &&");
    expect(tv).not.toContain("A sincronização com o Listo está atrasada ou falhou.");
    expect(hook).toContain("monitorFailures: 0");
  });
});
