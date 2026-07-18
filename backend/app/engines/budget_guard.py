"""Budget Guard (spec 7.5). Tracks spend against the ceiling and decides whether to
escalate pressure or hand off to the user."""
from __future__ import annotations


def evaluate(budget: dict, best_by_category: dict[str, float]) -> dict:
    ceiling = budget.get("total_ceiling", 0) or 0
    allocation = budget.get("allocation", {})
    spent = sum(best_by_category.values())
    per_category = []
    for cat, frac in allocation.items():
        cat_ceiling = ceiling * frac
        cat_spent = best_by_category.get(cat, 0)
        overrun = (cat_spent - cat_ceiling) / cat_ceiling if cat_ceiling else 0
        per_category.append({
            "category": cat,
            "ceiling": round(cat_ceiling, 2),
            "spent": round(cat_spent, 2),
            "overrun_pct": round(overrun * 100, 1),
        })
    total_overrun = (spent - ceiling) / ceiling if ceiling else 0
    if total_overrun > 0.25:
        action = "escalate_to_user"
    elif total_overrun > 0.10:
        action = "propose_reallocation"
    elif total_overrun > 0:
        action = "increase_pressure"
    else:
        action = "within_budget"
    return {
        "ceiling": ceiling,
        "spent": round(spent, 2),
        "remaining": round(ceiling - spent, 2),
        "overrun_pct": round(total_overrun * 100, 1),
        "action": action,
        "per_category": per_category,
        "hard_ceiling_breached": budget.get("hard_ceiling", False) and spent > ceiling,
    }
