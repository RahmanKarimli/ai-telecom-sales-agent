"""Fictional catalog and deterministic customer histories for the resettable demo."""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import utc_now
from backend.models import (
    Call,
    CallResult,
    CallTurn,
    Customer,
    Recommendation,
    TelecomPackage,
    UsageData,
)


def completed_months(as_of: date) -> list[date]:
    """Return the last three completed UTC calendar months, oldest first."""
    current = as_of.year * 12 + as_of.month - 1
    return [date(index // 12, index % 12 + 1, 1) for index in range(current - 3, current)]


def overage_minor(package: TelecomPackage, data_gb: float, call_minutes: int) -> int:
    data_overage = max(Decimal(0), Decimal(str(data_gb)) - Decimal(str(package.data_gb)))
    minute_overage = max(0, call_minutes - package.call_minutes)
    amount = data_overage * package.extra_gb_price_minor + Decimal(
        minute_overage * package.extra_minute_price_minor
    )
    return int(amount.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def seed_demo_data(session: Session, as_of: date | None = None) -> bool:
    """Seed once only when every application table is empty; caller owns the transaction."""
    tables = (TelecomPackage, Customer, UsageData, Recommendation, Call, CallTurn, CallResult)
    if any(session.scalar(select(table.id).limit(1)) is not None for table in tables):
        return False

    packages = [
        TelecomPackage(
            name=name,
            monthly_price_minor=price,
            currency="AZN",
            data_gb=data,
            call_minutes=minutes,
            extra_gb_price_minor=100,
            extra_minute_price_minor=5,
            verified_faq_json={
                "taxes": "The listed monthly price includes fictional taxes.",
                "contract": "There is no minimum contract.",
                "activation": (
                    "Activation requires employee processing. "
                    "This demo records interest and never changes a package or bill."
                ),
                "roaming": "Roaming is excluded.",
                "rollover": "Unused data and minutes do not roll over.",
            },
            active=True,
            version=1,
        )
        for name, price, data, minutes in (
            ("Starter", 1200, 5, 100),
            ("Everyday", 2000, 15, 300),
            ("Balanced", 2800, 30, 500),
            ("Plus", 4000, 50, 1000),
        )
    ]
    session.add_all(packages)
    session.flush()
    catalog = {package.name: package for package in packages}
    # Name, current package, three months of data/minutes, contact permission, opt-out.
    profiles = (
        ("Leyla", "Everyday", (25, 28, 30), (180, 200, 220), True, False),
        ("Murad", "Starter", (12, 14, 15), (240, 260, 280), True, False),
        ("Aysel", "Everyday", (12, 14, 15), (500, 500, 500), True, False),
        ("Rashad", "Balanced", (45, 48, 50), (450, 480, 490), True, False),
        ("Nigar", "Starter", (3, 4, 5), (450, 480, 500), True, False),
        ("Kamran", "Everyday", (8, 10, 12), (200, 240, 260), True, False),
        ("Farid", "Everyday", (60, 65, 70), (350, 400, 450), True, False),
        ("Gunel", "Everyday", (22, 23, 24), (200, 230, 250), True, False),
        ("Elvin", "Starter", (15, 15, 15), (290, 300, 300), True, False),
        ("Sabina", "Everyday", (26, 28, 29), (650, 700, 750), True, False),
        ("Orkhan", "Balanced", (20, 22, 24), (950, 1000, 1000), True, False),
        ("Narmin", "Everyday", (25, 28, 30), (200, 220, 240), True, True),
        ("Tural", "Starter", (15, 15, 15), (300, 300, 300), False, False),
        ("Sevil", "Plus", (41, 45, 49), (700, 800, 950), True, False),
        ("Emin", "Starter", (4, 5, 10), (80, 90, 200), True, False),
        ("Lala", "Everyday", (30, 30, 30), (300, 300, 300), True, False),
        ("Samir", "Balanced", (32, 35, 36), (510, 520, 530), True, False),
        ("Zahra", "Starter", (14, 15, 15), (290, 300, 300), True, False),
        ("Rauf", "Everyday", (35, 45, 50), (400, 450, 480), True, False),
        ("Fidan", "Starter", (15, 15, 15), (150, 200, 250), True, False),
    )
    months = completed_months(as_of or utc_now().date())
    for name, package_name, data, minutes, contact_allowed, do_not_contact in profiles:
        package = catalog[package_name]
        customer = Customer(
            name=name,
            current_package_id=package.id,
            contact_allowed=contact_allowed,
            do_not_contact=do_not_contact,
        )
        session.add(customer)
        session.flush()
        session.add_all(
            UsageData(
                customer_id=customer.id,
                month=month,
                data_gb=data_gb,
                call_minutes=call_minutes,
                extra_charges_minor=overage_minor(package, data_gb, call_minutes),
            )
            for month, data_gb, call_minutes in zip(months, data, minutes, strict=True)
        )
    session.flush()
    return True
