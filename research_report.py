"""Six question-led figures from the saved benchmark, never a second simulation."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize
import numpy as np
import pandas as pd
from research_model import STRATEGIES

LABELS = {"random": "Random walk", "biased": "Persistent walk", "greedy": "Global weighted choice",
          "tsp": "Global NN tour", "local_nearest": "Local nearest", "local_urgency_claims": "Local urgency + claims"}
COLORS = dict(zip(STRATEGIES, ["#ac6744", "#9b8454", "#697b9a", "#355777", "#46847d", "#176257"]))


def generate_report(report=None, output=Path("figures/research-v2")):
    report = report or json.loads(Path("research_results.json").read_text())
    runs = pd.DataFrame(report["runs"])
    main = runs[runs.variant == "main"].copy()
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    # Legacy imports set a global seaborn theme; reset it so CLI/notebook match.
    plt.rcdefaults()
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.titlesize": 16,
                         "axes.labelsize": 11, "figure.facecolor": "#faf9f5", "axes.facecolor": "#faf9f5",
                         "axes.spines.top": False, "axes.spines.right": False, "savefig.facecolor": "#faf9f5"})
    captions = []

    def save(fig, name, title, interpretation):
        fig.suptitle(title, x=.06, ha="left", fontsize=19, fontweight="bold")
        fig.tight_layout(rect=(0, .03, 1, .94))
        fig.savefig(output / f"{name}.png", dpi=160)
        plt.close(fig)
        captions.append({"file": f"{name}.png", "title": title, "interpretation": interpretation})

    grid = np.arange(0, report["fair_horizon"] + 1, 5)
    fig, axes = plt.subplots(1, 2, figsize=(12, 6.5), gridspec_kw={"width_ratios": [2.8, 1]}, sharey=True)
    for strategy in STRATEGIES:
        by_rep = {}
        for curve in report["curves"]:
            if curve["strategy"] != strategy or curve["variant"] != "main": continue
            points = curve["points"]
            # Coverage is a step function: do not invent feeding between observations.
            ticks = np.array([p["step"] for p in points])
            values = np.array([p["coverage"] for p in points])
            indices = np.maximum(0, np.searchsorted(ticks, grid, side="right") - 1)
            by_rep.setdefault(curve["replicate"], []).append(values[indices])
        matrix = np.array([np.mean(values, axis=0) for values in by_rep.values()])
        for ax in axes:
            ax.plot(grid, matrix.mean(axis=0) * 100, label=LABELS[strategy], color=COLORS[strategy], lw=2)
            ax.fill_between(grid, np.percentile(matrix, 10, axis=0) * 100,
                            np.percentile(matrix, 90, axis=0) * 100, color=COLORS[strategy], alpha=.12)
    axes[0].set(xlabel="Actual simulation tick / early-cycle detail", ylabel="Mean first-feed coverage (%)",
                xlim=(0, 600), ylim=(0, 102))
    axes[1].set(xlabel="Full fair horizon", xlim=(0, 3000), xticks=[0,1500,3000])
    axes[0].legend(loc="lower right", frameon=False, ncol=1, fontsize=10)
    for ax in axes: ax.grid(axis="y", alpha=.2)
    best = report["ranking"][0]["strategy"]
    save(fig, "01_coverage", "How quickly does each policy reach the whole colony?",
         f"Each line averages all 36 scenarios; shading is the 10th-90th percentile of ten replicate-level means, not a biological confidence interval. Finished runs hold at 100% through tick 3000. {LABELS[best]} ranks first by reliability, then median capped time, then movement per served larva; the local/global information distinction prevents a causal claim about routing alone.")

    fig, axes = plt.subplots(1, 2, figsize=(12, 6.5), gridspec_kw={"width_ratios": [1, 1.6]})
    reliability = main.groupby("strategy").finished.mean().reindex(STRATEGIES)
    axes[0].barh(range(6), reliability * 100, color=[COLORS[s] for s in STRATEGIES])
    axes[0].set(yticks=range(6), yticklabels=[LABELS[s] for s in STRATEGIES], xlim=(0, 110), xlabel="Finished by 3000 (%)")
    for i, rate in enumerate(reliability): axes[0].text(rate * 100 + 1, i, f"{rate:.1%}", va="center")
    distributions = [main[main.strategy == s].observed_steps for s in STRATEGIES]
    boxes = axes[1].boxplot(distributions, vert=False, tick_labels=[LABELS[s] for s in STRATEGIES], patch_artist=True)
    for patch, strategy in zip(boxes["boxes"], STRATEGIES): patch.set_facecolor(COLORS[strategy]); patch.set_alpha(.65)
    axes[1].set(xlabel="Completion tick (unfinished: capped at 3000)",
                xlim=(0, max(100, main.observed_steps.max() * 1.05)))
    axes[1].set_yticklabels([])
    if not main.finished.all(): axes[1].axvline(3000, color="#ac6744", linestyle="--", lw=1)
    save(fig, "02_reliability", "All policies finish; completion speed still differs" if main.finished.all() else "Reliability before speed: failures stay visible",
         f"The left panel reports completion frequency over {report['replicates'] * 36} runs per strategy. The right includes every run: an unfinished run contributes the fair horizon, never a fabricated completion tick. This is horizon-capped time, not an estimate of uncensored completion time; medians alone can hide the slow tail.")

    fig, ax = plt.subplots(figsize=(12, 6.5))
    data = [main[main.strategy == s].distance_per_served for s in STRATEGIES]
    boxes = ax.boxplot(data, vert=False, tick_labels=[LABELS[s] for s in STRATEGIES], patch_artist=True)
    for patch, strategy in zip(boxes["boxes"], STRATEGIES): patch.set_facecolor(COLORS[strategy]); patch.set_alpha(.7)
    ax.set(xlabel="Total cardinal movement / larvae served at fair stopping point")
    ax.grid(axis="x", alpha=.2)
    save(fig, "03_movement", "How much movement buys one first feed?",
         "Lower values mean less grid travel per served larva. Boxplots show all scenario-replicate runs rather than just four aggregate points. Read this with the reliability panel: a policy that serves fewer larvae is not automatically preferable because it moves less; distance is a computational proxy, not measured metabolic energy.")

    fig, axes = plt.subplots(1, 2, figsize=(12, 6.5), sharey=True)
    for ax, column, title in zip(axes, ["restricted_p95_wait", "priority_weighted_wait"],
                               ["Slow tail: 95th percentile wait", "Initial-priority-weighted mean wait"]):
        boxes = ax.boxplot([main[main.strategy == s][column] for s in STRATEGIES], vert=False,
                          tick_labels=[LABELS[s] for s in STRATEGIES], patch_artist=True)
        for patch, strategy in zip(boxes["boxes"], STRATEGIES): patch.set_facecolor(COLORS[strategy]); patch.set_alpha(.65)
        ax.set(xlabel="Restricted waiting ticks", title=title)
    save(fig, "04_waiting", "Does efficient routing leave larvae waiting?",
         "Each larva's wait starts at tick zero and ends at its first feed; unserved larvae are censored at 3000. The left measures the long-waiting tail, while the right weights waits by randomly assigned initial hunger. These are restricted waiting metrics and assumed priorities, not evidence of physiological starvation or measured welfare.")

    grouped = main.groupby(["scenario", "strategy"]).observed_steps.median().unstack().reindex(columns=STRATEGIES)
    fig, ax = plt.subplots(figsize=(12, 13))
    image = ax.imshow(grouped.to_numpy(), aspect="auto", cmap="YlGnBu", norm=Normalize(0, grouped.max().max()))
    ax.set(xticks=range(6), xticklabels=[LABELS[s] for s in STRATEGIES], yticks=range(len(grouped)), yticklabels=grouped.index)
    ax.tick_params(axis="x", labelrotation=25)
    finish = main.groupby(["scenario", "strategy"]).finished.sum()
    for y, scenario in enumerate(grouped.index):
        for x, strategy in enumerate(STRATEGIES):
            value = grouped.loc[scenario, strategy]
            failed = finish[scenario, strategy] < report["replicates"]
            ax.text(x, y, f"{value:.0f}{'*' if failed else ''}", ha="center", va="center", fontsize=8,
                    color="white" if value > grouped.max().max() * .5 else "#23343b")
    boundaries = [i - .5 for i in range(1, len(grouped)) if grouped.index[i].split("-")[0] != grouped.index[i-1].split("-")[0]]
    for line in boundaries: ax.axhline(line, color="white", lw=3)
    fig.colorbar(image, ax=ax, shrink=.7, label="Median horizon-capped ticks")
    save(fig, "05_scenarios", "Does the result survive every nest and bout?",
         "Rows retain all 36 scenarios, grouped into v14, v72 and v87; columns use one shared color scale. Numbers are medians over ten matched replicates, and an asterisk indicates at least one unfinished run. These scenarios reuse a nest's synthetic layout and differ in worker resources and seeds; they are not 36 independent biological colonies.")

    configurations = [("local_nearest", "main", "Nearest / no claims"),
                      ("local_urgency_claims", "no_claims", "Urgency / no claims"),
                      ("local_urgency_claims", "main", "Urgency / local claims"),
                      ("local_urgency_claims", "global_sensing", "Urgency / global sensing")]
    fig, axes = plt.subplots(1, 2, figsize=(12, 6.5), sharey=True)
    for ax, metric, xlabel in zip(axes, ["observed_steps", "messages"], ["Median capped ticks", "Median broadcast packets"]):
        values = []
        for strategy, variant, label in configurations:
            subset = runs[(runs.strategy == strategy) & (runs.variant == variant)]
            values.append(subset.groupby("replicate")[metric].median().to_numpy())
        boxes = ax.boxplot(values, vert=False, tick_labels=[c[2] for c in configurations], patch_artist=True)
        for patch in boxes["boxes"]: patch.set_facecolor("#46847d"); patch.set_alpha(.6)
        ax.set(xlabel=xlabel)
    local_time = runs[(runs.strategy == "local_urgency_claims") & (runs.variant == "main")].observed_steps.median()
    no_time = runs[(runs.strategy == "local_urgency_claims") & (runs.variant == "no_claims")].observed_steps.median()
    save(fig, "06_coordination", "Is communication worth its action cost?",
         f"The same 36 scenarios and ten seeds are paired across all four configurations; each box summarizes ten replicate-level medians. Claim broadcasts consume a tick instead of movement or feeding, and packets count separately from distance. Local claims have median capped time {local_time:.0f} versus {no_time:.0f} without claims; this result is reported even if coordination is slower. The global-sensing ablation changes information access, not the observed nest geometry.")
    (output / "captions.json").write_text(json.dumps(captions, indent=2), encoding="utf-8")
    return captions


if __name__ == "__main__":
    generate_report()
