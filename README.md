# Football AI Predictor

Machine-learning predictions for football (soccer) matches — BTTS, Draw, and Live outcomes.

## Features

| Predictor | Description |
|-----------|-------------|
| **BTTS**  | Predicts whether Both Teams will Score |
| **Draw**  | Predicts whether a match will end in a draw |
| **Live**  | In-play outcome prediction based on current match state |

## Project Structure

```
football-ai-predictor/
├── app.py              # Flask REST API
├── train.py            # CLI training script
├── requirements.txt
├── .env.example
├── api/
│   └── football_data.py    # football-data.org API client
├── config/
│   └── settings.py         # Environment config & constants
├── data/
│   ├── raw/                # Raw API responses (git-ignored)
│   └── processed/          # Processed CSVs (git-ignored)
├── models/
│   ├── base_model.py       # Shared model base class
│   ├── btts_model.py       # XGBoost BTTS classifier
│   ├── draw_model.py       # XGBoost Draw classifier
│   └── live_model.py       # XGBoost Live outcome classifier
├── predictors/
│   ├── btts_predictor.py
│   ├── draw_predictor.py
│   └── live_predictor.py
├── utils/
│   ├── preprocessing.py    # Match parsing & team stats
│   └── features.py         # Feature engineering
└── tests/
    └── test_preprocessing.py
```

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Add your football-data.org API key to .env
```

### 3. Train models

```bash
python train.py --competition PL --season 2023
```

Supported competition codes: `PL` (Premier League), `PD` (La Liga), `BL1` (Bundesliga), `SA` (Serie A), `FL1` (Ligue 1), `CL` (Champions League).

### 4. Start the API server

```bash
python app.py
```

## API Endpoints

### `POST /predict/btts`
```json
{
  "home_goals_scored_avg": 1.8,
  "away_goals_scored_avg": 1.2,
  "home_btts_rate": 0.65,
  "away_btts_rate": 0.55
}
```
Response:
```json
{
  "btts_yes_probability": 0.72,
  "btts_no_probability": 0.28,
  "prediction": "Yes"
}
```

### `POST /predict/draw`
Similar feature payload — returns `draw_probability` and `prediction`.

### `POST /predict/live`
Include live match state fields (`minute`, `home_goals_current`, `away_goals_current`, etc.) plus pre-match features.
Response includes win/draw/away probabilities and current `prediction`.

## Running Tests

```bash
pytest tests/
```

## API Key

Get a free key at [football-data.org](https://www.football-data.org/).
