# TrackBing 🏋️‍♂️🍽️

TrackBing is a comprehensive, React Native-based fitness and macro tracking mobile application. It allows users to easily calculate their daily caloric needs, scan food barcodes, and track their macronutrients (Protein, Carbs, Fat) with highly accurate, dynamic volume-to-weight conversions. 

Built with Expo and Supabase, TrackBing features a custom cloud-synced food database specifically tailored to include local Filipino dishes and popular grocery items.

## ✨ Features

* **Smart Daily Dashboard:** Visual circular progress rings and macro tracking bars that automatically reset every 24 hours.
* **Barcode Scanner:** Built-in camera scanner leveraging the Open Food Facts API to instantly pull nutritional data from packaged foods.
* **Advanced Unit Conversions:** Solves the "density problem" found in most apps. Seamlessly calculates macros across weights (`g`, `ml`, `oz`) and volumes/pieces (`cup`, `tbsp`, `tsp`, `serving`) based on the specific density of the food.
* **Custom Filipino Food DB:** Integrates a cloud-hosted JSON Gist database containing macros for local favorites (e.g., Bangus, Chicken Inasal, Balut, Puto, Adobo).
* **Personal Cookbook:** Users can create and save their own custom foods and recipes directly to their account.
* **Personalized TDEE Calculator:** Auto-calculates daily caloric limits based on user age, weight, height, gender, activity level, and weight goals.
* **Secure Authentication:** Full user signup and login flow handled securely by Supabase Auth.

## 🛠️ Built With

React Native | Expo | TypeScript | Supabase (PostgreSQL & Auth) | Phosphor Icons | React Native Circular Progress Indicator

## 🗄️ Database Schema (Supabase)

TrackBing uses a PostgreSQL backend via Supabase with three primary tables linked to the `auth.users` ID:

* **`user_goals`**: Stores the user's physical stats (height, weight, age, activity level) and calculated daily macro targets.
* **`personal_foods`**: A private database for users to store their custom-created meals and ingredients.
* **`food_logs`**: The daily diary tracking what the user has eaten, the serving size, the unit used, and the calculated macros. 

## 🚀 Getting Started

### Nutrition target migration

Apply
`supabase/migrations/20260614000000_add_nutrition_goal_metadata.sql`
before deploying the updated signup, profile, or dashboard screens. The
migration is non-destructive: existing calorie targets are preserved and rows
without metadata load as existing custom targets until the user selects a new
plan.

### Prerequisites
* Node.js installed on your machine
* Expo Go app installed on your physical mobile device (or Android Studio / Xcode for emulators)
* A Supabase project


## DeepSeek Bee and nutrition-label photos

The active provider is now DeepSeek V4 Pro, with DeepSeek Flash for optional label-photo transcription. See [current setup, review flow and verification limits](docs/deepseek-label-photos.md). This October 18 change supersedes the Gemini provider choice in the September brief.

See the [current launch checklist and deployment blockers](docs/launch/2026-10-18-release-readiness.md) for verified local versus production status. Main now requires the CI gate; the current security audit still blocks release.

## Adaptive Bee and launch implementation

The original launch brief is [TrackBing_Gemini_Search_Migration_README.md](TrackBing_Gemini_Search_Migration_README.md). Basic manual tracking stays free; Plus offers limited food assistance; Pro enables adaptive Bee. Server-confirmed food, weight and goal reviews, account-controlled memories, live Search, subscription verification and monthly allowances share one Supabase backend across Expo clients.

See [Bee food and recipe creation](docs/bee-food-recipes.md), [deployment and provider setup](docs/bee-gemini-deployment.md) and the [20-item launch evidence report](docs/launch/2026-09-27-implementation-report.md). These documents distinguish local code/tests from missing live credentials, legal decisions, payment/store setup and production/native-device verification. No production deployment is implied.

## CI and releases

Pull requests run parallel app, database, security, web/browser, and native-export checks. The **Ready to merge** check collects every result. Web/backend releases and signed native builds are separate, manual workflows that verify the exact main commit and use protected environments.

See the [CI and release guide](docs/CI_CD.md) for the pipeline, GitHub/provider setup, dependency findings, verification evidence, and recovery instructions. Automatic Vercel Git deployments are disabled in the release configuration; configure the workflow before adopting that release path.
