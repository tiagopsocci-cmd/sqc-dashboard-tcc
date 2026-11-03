"""Standalone SQC request dependencies.

The demo has no authentication or authorization tables.  A single immutable
actor identity is injected wherever the original domain records audit events.
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends


@dataclass(frozen=True, slots=True)
class DemoActor:
    email: str = "demo@localhost.invalid"


_demo_actor = DemoActor()


def get_demo_actor() -> DemoActor:
    return _demo_actor


CurrentActor = Annotated[DemoActor, Depends(get_demo_actor)]
# Keep domain-facing names so the copied router remains easy to compare with the
# upstream SQC implementation; all three resolve to the same local demo actor.
CurrentUser = CurrentActor
SqcWriter = CurrentActor
SqcEngineer = CurrentActor
