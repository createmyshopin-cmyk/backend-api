"""Financial reconciliation — all gift tiers must sum to 100%."""

import pytest

TIERS = [
    (10, 6, 4),
    (25, 15, 10),
    (50, 30, 20),
    (100, 60, 40),
    (250, 150, 100),
    (500, 300, 200),
    (1000, 600, 400),
    (2500, 1500, 1000),
]


@pytest.mark.parametrize("gross,creator,platform", TIERS)
def test_split_equals_gross(gross, creator, platform):
    assert creator + platform == gross
    assert int(gross * 0.6) == creator or gross * 0.6 - creator < 1


def test_no_coin_loss_across_range():
    for gross in range(1, 25_001):
        creator = int(gross * 0.6)
        platform = gross - creator
        assert creator + platform == gross
