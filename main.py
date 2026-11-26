"""智投引擎 AdFlow 入口。

启动：python main.py     （默认监听 0.0.0.0:8788，零第三方依赖）
"""

from app.api.server import run

if __name__ == "__main__":
    run()
