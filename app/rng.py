MASK = 0xFFFFFFFF

def mulberry32(seed):
    """返回一个每次产生 [0, 1) 浮点数的闭包。"""
    a = seed & MASK

    def next_float():
        nonlocal a
        a = (a + 0x6D2B79F5) & MASK
        t = (a ^ (a >> 15)) & MASK
        t = (t * (1 | a)) & MASK
        t = ((t + ((t ^ (t >> 7)) * (61 | t))) ^ t) & MASK
        t = (t ^ (t >> 14)) & MASK
        return t / 4294967296.0

    return next_float


def noise(rng, amp=0.08):
    """对应前端 noise(amp) = 1 + (R() - .5) * 2 * amp。"""
    return 1 + (rng() - 0.5) * 2 * amp
