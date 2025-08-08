from flask import Flask, request, jsonify
import subprocess
import os
import requests
from bs4 import BeautifulSoup

app = Flask(__name__)

def is_dynamic(url):
    try:
        response = requests.get(url, timeout=10)
        if "<script" in response.text.lower() and len(response.text) < 300:
            return True
        return False
    except:
        return True  # fallback to dynamic if request fails

def scrape_static(url):
    try:
        response = requests.get(url, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        text = soup.get_text(separator='\n', strip=True)
        return text
    except Exception as e:
        return f"[Error scraping static site] {str(e)}"

@app.route('/scrape', methods=['POST'])
def scrape():
    data = request.get_json()
    url = data.get("url")

    if not url:
        return jsonify({"error": "Missing URL"}), 400

    dynamic = is_dynamic(url)
    if dynamic:
        try:
            result = subprocess.run(
                ["node", "puppeteer_scraper.js", url],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=20
            )
            if result.returncode != 0:
                return jsonify({"error": "Dynamic scrape failed", "stderr": result.stderr.decode()}), 500
            return jsonify({"type": "dynamic", "text": result.stdout.decode().strip()})
        except Exception as e:
            return jsonify({"error": "Node subprocess failed", "exception": str(e)}), 500
    else:
        text = scrape_static(url)
        return jsonify({"type": "static", "text": text})

if __name__ == '__main__':
    app.run(debug=True)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))

