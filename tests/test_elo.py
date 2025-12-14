from chess_club import elo


def test_expected_score():
    assert round(elo.expected_score(1200, 1200), 5) == round(0.5, 5)
    assert elo.expected_score(1400, 1200) > 0.75


def test_k_factor():
    assert elo.k_factor(0) == 40
    assert elo.k_factor(25) == 20
    assert elo.k_factor(100) == 10


def test_update_elo():
    new1, new2 = elo.update_elo(1200, 1200, 1, 40, 40)
    assert new1 > 1200
    assert new2 < 1200
