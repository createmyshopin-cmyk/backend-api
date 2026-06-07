"""Financial accuracy tests — revenue split verification."""

import pytest

GIFT_TIERS = [
    (10, 6, 4),
    (25, 15, 10),
    (50, 30, 20),
    (100, 60, 40),
    (250, 150, 100),
    (500, 300, 200),
    (1000, 600, 400),
    (2500, 1500, 1000),
]


@pytest.mark.parametrize("gross,creator,platform", GIFT_TIERS)
def test_revenue_split_60_40(gross: int, creator: int, platform: int):
    computed_creator = int(gross * 0.6)  # matches FLOOR in SQL
    computed_platform = gross - computed_creator
    assert computed_creator == creator
    assert computed_platform == platform
    assert computed_creator + computed_platform == gross


def test_floor_split_never_loses_coins():
    for gross in range(1, 10_001):
        creator = int(gross * 0.6)
        platform = gross - creator
        assert creator + platform == gross
        assert creator >= 0
        assert platform >= 0
