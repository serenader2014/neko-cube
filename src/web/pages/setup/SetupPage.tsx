import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SETUP_STEPS } from "./constants";
import { getAdjacentStepId, getSetupStepIndex, writeSetupDismissed } from "./helpers";
import { useSetupDashboard } from "./hooks";
import { SetupLaunchStep, SetupSourcesStep, SetupTargetStep, SetupWelcomeStep } from "./SetupSteps";
import type { SetupStepId } from "./types";

export function SetupPage() {
  const navigate = useNavigate();
  const [stepId, setStepId] = useState<SetupStepId>("welcome");
  const dashboardQuery = useSetupDashboard();
  const stepIndex = getSetupStepIndex(stepId);
  const activeStep = SETUP_STEPS[stepIndex];

  function leaveSetup(destination: string) {
    writeSetupDismissed();
    navigate(destination, { replace: true });
  }

  return (
    <div className="setup-page">
      <header className="setup-header">
        <div>
          <p className="eyebrow">初始化向导</p>
          <h2>欢迎使用 NekoCube</h2>
          <p className="muted">完成几步基础配置即可开始使用；所有内容之后都能在「订阅与配置」中修改。</p>
        </div>
        <button className="button-secondary" onClick={() => leaveSetup("/runtime")} type="button">
          跳过初始化
        </button>
      </header>

      <ol className="setup-stepper">
        {SETUP_STEPS.map((step, index) => (
          <li
            className={`setup-stepper-item ${index === stepIndex ? "is-active" : ""} ${index < stepIndex ? "is-done" : ""}`}
            key={step.id}
          >
            <button onClick={() => setStepId(step.id)} type="button">
              <span className="setup-stepper-index">{index + 1}</span>
              <span className="setup-stepper-copy">
                <strong>{step.title}</strong>
                <small>{step.description}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <section className="panel setup-panel">
        <h3>{activeStep.title}</h3>
        {stepId === "welcome" ? (
          <SetupWelcomeStep onImported={() => setStepId("target")} onStart={() => setStepId("sources")} />
        ) : null}
        {stepId === "sources" ? <SetupSourcesStep sources={dashboardQuery.data?.sources ?? []} /> : null}
        {stepId === "target" ? <SetupTargetStep /> : null}
        {stepId === "launch" && dashboardQuery.data ? (
          <SetupLaunchStep dashboard={dashboardQuery.data} onFinish={() => leaveSetup("/runtime")} />
        ) : null}

        <footer className="setup-footer">
          <button
            className="button-secondary"
            disabled={stepIndex === 0}
            onClick={() => setStepId(getAdjacentStepId(stepId, -1))}
            type="button"
          >
            上一步
          </button>
          {stepIndex < SETUP_STEPS.length - 1 ? (
            <button className="button" onClick={() => setStepId(getAdjacentStepId(stepId, 1))} type="button">
              下一步
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
