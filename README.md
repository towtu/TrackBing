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
