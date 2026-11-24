"""
Management command to train and validate the shoulder estimator model (Prompt 7).

Usage:
    python manage.py train_shoulder_model
    python manage.py train_shoulder_model --version custom-v1 --force
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from catalog.shoulder_estimate import train_model


class Command(BaseCommand):
    help = "Train the shoulder width estimator model from real measurements and size charts."

    def add_arguments(self, parser):
        parser.add_argument(
            "--model-version",
            dest="model_version",
            type=str,
            default=None,
            help="Custom version string for this model run.",
        )
        parser.add_argument(
            "--no-activate",
            action="store_true",
            help="Do not activate the model even if it is better.",
        )

    def handle(self, *args, **options):
        version = options.get("model_version")
        activate_if_better = not options.get("no_activate")

        self.stdout.write("Training shoulder width estimator model...")
        report = train_model(version=version, activate_if_better=activate_if_better)

        status_str = "ACTIVATED" if report["activated"] else "KEPT INACTIVE (did not beat active model or --no-activate)"

        self.stdout.write("")
        self.stdout.write("=" * 60)
        self.stdout.write("        Shoulder Width Estimator Training Report        ")
        self.stdout.write("=" * 60)
        self.stdout.write(f"Model version : {report['version']}")
        self.stdout.write(f"Real samples  : {report['n_real']}")
        self.stdout.write(f"Chart samples : {report['n_chart']}")
        self.stdout.write(f"Residual sigma: {report['sigma_cm']:.2f} cm (boy: {report.get('sigma_boy', report['sigma_cm']):.2f} cm, girl: {report.get('sigma_girl', report['sigma_cm']):.2f} cm)")
        self.stdout.write(f"MAE (CV / fit): {report['mae_cm']:.2f} cm")
        self.stdout.write(f"RMSE          : {report['rmse_cm']:.2f} cm")
        self.stdout.write(f"Status        : {status_str}")
        self.stdout.write("=" * 60)
        self.stdout.write(self.style.SUCCESS("Model training completed successfully."))
