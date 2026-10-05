"""Independent quadrature checks of the 2D angular collision measure and bubble."""
import numpy as np


def elliptic_geometry_check():
    """Compare the AGM reduction with an independent endpoint quadrature."""
    for p, p1, p2 in [(1.0, 1.2, 0.8), (0.7, 0.85, 1.1), (1.01, 1.0, 0.95)]:
        p3 = np.sqrt(p1 * p1 + p2 * p2 - p * p)
        a2, b2 = (p - p1) ** 2, (p + p1) ** 2
        c2, d2 = (p2 - p3) ** 2, (p2 + p3) ** 2
        lo, hi = max(a2, c2), min(b2, d2)
        outer_lo, outer_hi = min(a2, c2), max(b2, d2)
        phi = np.pi * (np.arange(100000) + 0.5) / 100000
        x = (lo + hi) / 2 + (hi - lo) / 2 * np.cos(phi)
        direct = np.mean(1 / np.sqrt((x - outer_lo) * (outer_hi - x))) * np.pi / 2
        big = max(p * p3, p1 * p2)
        gap = abs((p * p - p1 * p1) * (p * p - p2 * p2))
        aa, bb = 1.0, np.sqrt(gap) / big
        for _ in range(32):
            aa, bb = (aa + bb) / 2, np.sqrt(aa * bb)
        exact = np.pi / (4 * big * aa)
        rel = abs(direct / exact - 1)
        print(f'elliptic geometry p={p:g}, p1={p1:g}, p2={p2:g}: relative {rel:.3g}')
        assert rel < 1e-7


def collision_check(p=1.0, p1=1.2, p2=0.8, count=240, sigma=0.05):
    p3 = np.sqrt(p1 * p1 + p2 * p2 - p * p)
    a, b = (p - p1) ** 2, (p + p1) ** 2
    c, d = (p2 - p3) ** 2, (p2 + p3) ** 2
    lo, hi = max(a, c), min(b, d)
    theta = np.pi * (np.arange(4000) + 0.5) / 4000
    x = (lo + hi) / 2 + (hi - lo) / 2 * np.cos(theta)
    integral = np.sum(np.pi / 8000 / np.sqrt((x - min(a, c)) * (max(b, d) - x)))
    t = 2 * np.pi * np.arange(count) / count
    cx1, sx1 = p1 * np.cos(t), p1 * np.sin(t)
    cx2, sx2 = p2 * np.cos(t), p2 * np.sin(t)
    cx3, sx3 = p3 * np.cos(t), p3 * np.sin(t)
    rx = p + cx3[:, None, None] - cx1[None, :, None] - cx2[None, None, :]
    ry = sx3[:, None, None] - sx1[None, :, None] - sx2[None, None, :]
    direct = np.exp(-(rx * rx + ry * ry) / (2 * sigma * sigma)).mean() * (2 * np.pi) ** 2 / sigma ** 2
    predicted = 16 * integral
    return direct, predicted


def bubble_check(A=1.1, Q=0.7, eta=0.04):
    s = (np.arange(2400) + 0.5) * 6 / 2400
    theta = 2 * np.pi * np.arange(1600) / 1600
    integrand = (s[:, None] * np.exp(-s[:, None] ** 2) /
                 (A + 1j * eta - 2 * s[:, None] * Q * np.cos(theta)[None, :]))
    direct = np.mean(integrand, axis=1).sum() * 6 / 2400
    root = np.sign(A) / np.sqrt((A + 1j * eta) ** 2 - (2 * s * Q) ** 2)
    predicted = np.sum(s * np.exp(-s * s) * root) * 6 / 2400
    return direct, predicted


if __name__ == '__main__':
    elliptic_geometry_check()
    a, b = collision_check()
    print(f'collision angular: direct {a:.8g}, transfer integral {b:.8g}, relative {a / b - 1:.3%}')
    assert abs(a / b - 1) < 0.06
    for A in [1.1, -1.1, 0.25]:
        a, b = bubble_check(A=A)
        print(f'bubble A={A}: direct {a:.8g}, square-root {b:.8g}, relative {abs(a-b)/abs(b):.3%}')
        assert abs(a - b) / abs(b) < 0.01
