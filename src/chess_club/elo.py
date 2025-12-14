from math import pow

def expected_score(rating_a, rating_b):
    return 1 / (1 + 10 ** ((rating_b - rating_a) / 400))


def k_factor(games_played):
    if games_played < 20:
        return 40
    elif games_played < 50:
        return 20
    else:
        return 10


def update_elo(rating_a, rating_b, score_a, k_a, k_b):
    exp_a = expected_score(rating_a, rating_b)
    exp_b = 1 - exp_a

    s_a = score_a
    s_b = 1 - score_a

    new_a = rating_a + k_a * (s_a - exp_a)
    new_b = rating_b + k_b * (s_b - exp_b)

    return round(new_a, 2), round(new_b, 2)
