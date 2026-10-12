import io
import re
from typing import Any, Dict, List, Optional, Tuple
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from app.schemas.schedule import (
    ExtractedScheduleItem,
    ScheduleExtractionError,
    ScheduleIngestResponse,
    ScheduleApplyResponse,
)
from app.models.session import TrainingSession
from app.api.v1.auth.repository_interfaces import IUserRepository
from app.api.v1.schedules.repository_interfaces import IScheduleRepository


class ExcelIngestionService:

    COLUMN_ALIASES = {
        "batch_id": ("batch id", "batch_id", "batch", "batch code", "batch no"),
        "date_of_training": ("date of training", "training date", "date", "session date"),
        "start_time": ("start time", "start", "session start"),
        "end_time": ("end time", "end", "session end"),
        "topic": ("topic", "session topic", "module", "subject", "program", "program name"),
        "faculty_name": ("faculty name", "faculty", "trainer", "instructor"),
        "no_of_hours": ("no of hours", "hours", "duration", "session hours"),
        "venue": ("venue", "room", "location"),
        "location_city": ("location city", "city", "location"),
        "mode_of_delivery": ("mode of delivery", "delivery mode", "mode", "delivery"),
    }

    @staticmethod
    def _clean_str(val: Any) -> Optional[str]:
        if pd.isna(val) or val is None:
            return None
        s = str(val).strip()
        return s if s else None

    @staticmethod
    def _clean_decimal(val: Any, default: Decimal = Decimal("0.0")) -> Decimal:
        if pd.isna(val) or val is None:
            return default
        try:
            return Decimal(str(val).replace(",", "").strip())
        except (TypeError, ValueError, ArithmeticError):
            return default

    @staticmethod
    def _parse_datetime(val: Any) -> Optional[datetime]:
        if val is None or pd.isna(val):
            return None
        if isinstance(val, datetime):
            return val
        if isinstance(val, date):
            return datetime.combine(val, time.min)

        # Excel may expose dates as serial day numbers rather than date objects.
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            if 1 <= float(val) <= 100000:
                parsed = pd.Timestamp("1899-12-30") + pd.to_timedelta(float(val), unit="D")
            else:
                parsed = pd.NaT
        else:
            value = str(val).strip()
            if not value:
                return None
            # Try ISO format first (YYYY-MM-DD), then dayfirst (DD-MM-YYYY)
            parsed = pd.to_datetime(value, errors="coerce")
            if pd.isna(parsed):
                parsed = pd.to_datetime(value, errors="coerce", dayfirst=True)
        if pd.isna(parsed):
            return None
        return parsed.to_pydatetime() if hasattr(parsed, "to_pydatetime") else parsed

    @staticmethod
    def _parse_time(val: Any) -> Optional[time]:
        if val is None or pd.isna(val):
            return None
        if isinstance(val, time):
            return val.replace(tzinfo=None)
        if isinstance(val, datetime):
            return val.time().replace(tzinfo=None)
        parsed = pd.to_datetime(str(val), errors="coerce")
        if pd.isna(parsed):
            return None
        return parsed.to_pydatetime().time().replace(tzinfo=None)

    @classmethod
    def _column_map(cls, columns: List[Any]) -> Dict[str, str]:
        def normalize(value: Any) -> str:
            return re.sub(r"[^a-z0-9]+", " ", str(value).strip().lower()).strip()

        normalized = {normalize(column): str(column) for column in columns}
        result: Dict[str, str] = {}
        for field, aliases in cls.COLUMN_ALIASES.items():
            for alias in aliases:
                alias_normalized = normalize(alias)
                exact = normalized.get(alias_normalized)
                if exact:
                    result[field] = exact
                    break
                for header, original in normalized.items():
                    if alias_normalized in header or header in alias_normalized:
                        result[field] = original
                        break
                if field in result:
                    break
        return result

    @classmethod
    def _find_header_row(cls, raw_sheet: pd.DataFrame) -> Optional[int]:
        """Find a schedule header when a worksheet has title rows above it."""
        for row_index in range(min(len(raw_sheet), 10)):
            columns = cls._column_map(raw_sheet.iloc[row_index].tolist())
            if "date_of_training" in columns and "topic" in columns:
                return row_index
        return None

    @classmethod
    def _detect_schedule_format(cls, df: pd.DataFrame, sheet_name: str) -> str:
        """Detect the format of the schedule sheet."""
        columns = [str(c).lower() for c in df.columns]
        
        # Format 2: TOC format (has Date, Day, Duration, Module, Subtopic) - check FIRST
        toc_indicators = {"date", "day", "duration", "module", "subtopic"}
        if toc_indicators.issubset(set(columns)):
            return "toc"
        
        # Format 3: Module curriculum (has Module, Subtopic, Hours)
        module_indicators = {"module", "subtopic", "hours"}
        if module_indicators.issubset(set(columns)):
            return "curriculum"
        
        # Format 4: Topic-as-column format (Date, Day, Duration + topic columns with complex names)
        # Has Date, Day, Duration, and at least one column that looks like a topic/module name
        if {"date", "day", "duration"}.issubset(set(columns)):
            # Check if there are columns that aren't standard metadata columns
            metadata_cols = {"date", "day", "wk", "week", "location", "duration", "faculty", "trainer", "instructor"}
            topic_like_cols = [c for c in columns if c not in metadata_cols and "unnamed" not in c]
            if topic_like_cols:
                return "topic_column"
        
        # Format 1: Standard flat schedule (has date + topic columns) - check LAST
        col_map = cls._column_map(list(df.columns))
        if "date_of_training" in col_map and "topic" in col_map:
            return "flat"
        
        return "unknown"

    @classmethod
    def _parse_toc_format(cls, df: pd.DataFrame, sheet_name: str, target_batch_id: Optional[str]) -> Tuple[List[ExtractedScheduleItem], List[ScheduleExtractionError]]:
        """Parse TOC format: Date headers with subtopics underneath."""
        items = []
        errors = []
        
        col_map = cls._column_map(list(df.columns))
        date_col = col_map.get("date_of_training") or col_map.get("date")
        topic_col = col_map.get("topic") or col_map.get("subtopic")
        duration_col = col_map.get("no_of_hours") or col_map.get("duration")
        module_col = col_map.get("module")
        
        if not date_col or not topic_col:
            errors.append(ScheduleExtractionError(
                source_sheet=sheet_name,
                source_row=1,
                message="TOC format requires Date and Subtopic/Topic columns"
            ))
            return items, errors
        
        current_date = None
        current_day = None
        current_day_hours = Decimal("8.0")
        
        for index, row in df.iterrows():
            source_row = int(index) + 2
            try:
                if row.isna().all():
                    continue
                
                # Check if this row has a date (day header)
                date_val = row.get(date_col)
                parsed_date = cls._parse_datetime(date_val) if date_val is not None and not pd.isna(date_val) else None
                
                topic_val = cls._clean_str(row.get(topic_col)) if topic_col else None
                module_val = cls._clean_str(row.get(module_col)) if module_col else None
                duration_val = cls._clean_decimal(row.get(duration_col)) if duration_col else None
                
                if parsed_date:
                    # This is a day header row
                    current_date = parsed_date
                    current_day = cls._clean_str(row.get(col_map.get("day"))) if col_map.get("day") else None
                    # Store day hours for subtopics
                    if duration_val and duration_val > 0:
                        current_day_hours = duration_val
                    else:
                        current_day_hours = Decimal("8.0")
                    # If day header also has a topic, treat it as a session
                    if topic_val and topic_val.lower() not in ["", "nan", "none"]:
                        items.append(cls._create_item(
                            sheet_name, source_row, target_batch_id,
                            current_date, topic_val, module_val,
                            current_day_hours, row, col_map
                        ))
                elif topic_val and current_date:
                    # This is a subtopic under the current day
                    # Use day header hours if subtopic has no hours
                    effective_hours = duration_val if duration_val and duration_val > 0 else current_day_hours
                    items.append(cls._create_item(
                        sheet_name, source_row, target_batch_id,
                        current_date, topic_val, module_val,
                        effective_hours, row, col_map
                    ))
                elif topic_val and not current_date:
                    # Topic without a date - skip or use default
                    errors.append(ScheduleExtractionError(
                        source_sheet=sheet_name,
                        source_row=source_row,
                        message=f"Topic '{topic_val}' has no associated date"
                    ))
                    
            except (ValueError, TypeError) as exc:
                errors.append(ScheduleExtractionError(
                    source_sheet=sheet_name,
                    source_row=source_row,
                    message=str(exc),
                ))
        
        return items, errors

    @classmethod
    def _parse_curriculum_format(cls, df: pd.DataFrame, sheet_name: str, target_batch_id: Optional[str]) -> Tuple[List[ExtractedScheduleItem], List[ScheduleExtractionError]]:
        """Parse curriculum format: Module/Subtopic/Hours without dates."""
        items = []
        errors = []
        
        col_map = cls._column_map(list(df.columns))
        topic_col = col_map.get("topic") or col_map.get("subtopic")
        module_col = col_map.get("module")
        hours_col = col_map.get("no_of_hours") or col_map.get("hours")
        
        if not topic_col:
            errors.append(ScheduleExtractionError(
                source_sheet=sheet_name,
                source_row=1,
                message="Curriculum format requires Subtopic/Topic column"
            ))
            return items, errors
        
        current_module = None
        current_module_hours = Decimal("8.0")
        sequence = 0
        
        for index, row in df.iterrows():
            source_row = int(index) + 2
            try:
                if row.isna().all():
                    continue
                
                module_val = cls._clean_str(row.get(module_col)) if module_col else None
                topic_val = cls._clean_str(row.get(topic_col)) if topic_col else None
                hours_val = cls._clean_decimal(row.get(hours_col)) if hours_col else None
                
                if module_val and not topic_val:
                    # This is a module header - store its hours for subtopics
                    current_module = module_val
                    if hours_val and hours_val > 0:
                        current_module_hours = hours_val
                    continue
                
                if topic_val:
                    sequence += 1
                    # Use module hours if subtopic has no hours, else use subtopic hours, else default 8.0
                    effective_hours = hours_val if hours_val and hours_val > 0 else current_module_hours
                    if effective_hours <= 0:
                        effective_hours = Decimal("8.0")
                    # Cap at 24 hours per session
                    if effective_hours > Decimal("24.0"):
                        effective_hours = Decimal("24.0")
                    
                    # For curriculum without dates, assign sequential dates
                    placeholder_date = datetime(2026, 1, 1) + timedelta(days=sequence)
                    
                    items.append(ExtractedScheduleItem(
                        source_sheet=sheet_name,
                        source_row=source_row,
                        batch_id=target_batch_id,
                        date_of_training=placeholder_date,
                        start_time=time(9, 0),
                        end_time=time(17, 0),
                        topic=f"{current_module}: {topic_val}" if current_module else topic_val,
                        faculty_name=None,
                        no_of_hours=effective_hours,
                        venue=None,
                        location_city=None,
                        mode_of_delivery="Online",
                    ))
                    
            except (ValueError, TypeError) as exc:
                errors.append(ScheduleExtractionError(
                    source_sheet=sheet_name,
                    source_row=source_row,
                    message=str(exc),
                ))
        
        if not items:
            errors.append(ScheduleExtractionError(
                source_sheet=sheet_name,
                source_row=1,
                message="No valid curriculum topics found"
            ))
        
        return items, errors

    @classmethod
    def _parse_topic_column_format(cls, df: pd.DataFrame, sheet_name: str, target_batch_id: Optional[str]) -> Tuple[List[ExtractedScheduleItem], List[ScheduleExtractionError]]:
        """Parse topic-as-column format: Date, Day, Duration + topic columns with complex names.
        
        Each row has a date, and topic columns contain the module/topic name.
        Duration column has hours. Faculty column may have trainer name.
        """
        items = []
        errors = []
        
        col_map = cls._column_map(list(df.columns))
        date_col = col_map.get("date_of_training") or col_map.get("date")
        duration_col = col_map.get("no_of_hours") or col_map.get("duration")
        faculty_col = col_map.get("faculty_name") or col_map.get("faculty") or col_map.get("trainer")
        location_col = col_map.get("location_city") or col_map.get("location") or col_map.get("venue")
        mode_col = col_map.get("mode_of_delivery") or col_map.get("mode")
        
        if not date_col:
            errors.append(ScheduleExtractionError(
                source_sheet=sheet_name,
                source_row=1,
                message="Topic-column format requires a Date column"
            ))
            return items, errors
        
        # Identify topic columns (non-metadata columns)
        metadata_cols = {"date", "day", "wk", "week", "location", "duration", "faculty", "trainer", "instructor", "mode", "delivery", "venue"}
        topic_columns = []
        for col in df.columns:
            col_lower = str(col).lower().strip()
            if col_lower not in metadata_cols and "unnamed" not in col_lower:
                topic_columns.append(col)
        
        if not topic_columns:
            errors.append(ScheduleExtractionError(
                source_sheet=sheet_name,
                source_row=1,
                message="No topic columns found (columns with topic/module names)"
            ))
            return items, errors
        
        for index, row in df.iterrows():
            source_row = int(index) + 2
            try:
                if row.isna().all():
                    continue
                
                # Parse date
                date_val = row.get(date_col)
                parsed_date = cls._parse_datetime(date_val) if date_val is not None and not pd.isna(date_val) else None
                if not parsed_date:
                    continue  # Skip rows without valid date
                
                # Get duration
                duration_val = cls._clean_decimal(row.get(duration_col)) if duration_col else Decimal("8.0")
                if not duration_val or duration_val <= 0:
                    duration_val = Decimal("8.0")
                if duration_val > Decimal("24.0"):
                    duration_val = Decimal("24.0")
                
                # Get faculty
                faculty_name = cls._clean_str(row.get(faculty_col)) if faculty_col else None
                
                # Get location
                location_city = cls._clean_str(row.get(location_col)) if location_col else None
                
                # Get mode
                mode_of_delivery = cls._clean_str(row.get(mode_col)) if mode_col else "Online"
                
                # Process each topic column
                for topic_col in topic_columns:
                    topic_val = cls._clean_str(row.get(topic_col))
                    if not topic_val:
                        continue
                    
                    # Skip if topic looks like a header/metadata
                    topic_lower = topic_val.lower()
                    if topic_lower in {"topic", "module", "subject", "program", "name", "nan", "none"}:
                        continue
                    
                    items.append(ExtractedScheduleItem(
                        source_sheet=sheet_name,
                        source_row=source_row,
                        batch_id=target_batch_id,
                        date_of_training=parsed_date,
                        start_time=time(9, 0),
                        end_time=time(17, 0),
                        topic=topic_val,
                        faculty_name=faculty_name,
                        no_of_hours=duration_val,
                        venue=location_city,
                        location_city=location_city,
                        mode_of_delivery=mode_of_delivery,
                    ))
                    
            except (ValueError, TypeError) as exc:
                errors.append(ScheduleExtractionError(
                    source_sheet=sheet_name,
                    source_row=source_row,
                    message=str(exc),
                ))
        
        return items, errors

    @classmethod
    def _create_item(cls, sheet_name: str, source_row: int, target_batch_id: Optional[str],
                     training_date: datetime, topic: str, module: Optional[str],
                     hours: Decimal, row: pd.Series, col_map: Dict[str, str]) -> ExtractedScheduleItem:
        """Create an ExtractedScheduleItem from parsed data."""
        full_topic = f"{module}: {topic}" if module and module.lower() not in topic.lower() else topic
        
        return ExtractedScheduleItem(
            source_sheet=sheet_name,
            source_row=source_row,
            batch_id=target_batch_id,
            date_of_training=training_date,
            start_time=cls._parse_time(row.get(col_map.get("start_time"))) if col_map.get("start_time") else time(9, 0),
            end_time=cls._parse_time(row.get(col_map.get("end_time"))) if col_map.get("end_time") else time(17, 0),
            topic=full_topic,
            faculty_name=cls._clean_str(row.get(col_map.get("faculty_name"))) if col_map.get("faculty_name") else None,
            no_of_hours=hours,
            venue=cls._clean_str(row.get(col_map.get("venue"))) if col_map.get("venue") else None,
            location_city=cls._clean_str(row.get(col_map.get("location_city"))) if col_map.get("location_city") else None,
            mode_of_delivery=cls._clean_str(row.get(col_map.get("mode_of_delivery"))) or "Online" if col_map.get("mode_of_delivery") else "Online",
        )

    @classmethod
    def ingest_schedule_file(
        cls,
        file_contents: bytes,
        filename: str,
        target_batch_id: Optional[str] = None
    ) -> ScheduleIngestResponse:
        """
        Extracts normalized schedule records from every workbook sheet.

        This method intentionally has no database dependency or persistence side effect.
        Supports multiple formats:
        - Flat schedule (standard): Date, Topic, Time, Faculty, etc. per row
        - TOC format: Day headers with dates, subtopics underneath
        - Curriculum format: Module/Subtopic/Hours without dates (assigns sequential dates)
        """
        try:
            if filename.lower().endswith(".csv"):
                sheets = {"CSV": pd.read_csv(io.BytesIO(file_contents))}
            else:
                sheets = pd.read_excel(io.BytesIO(file_contents), sheet_name=None)
        except Exception as e:
            return ScheduleIngestResponse(
                success=False,
                message=f"Could not read spreadsheet file: {str(e)}",
                filename=filename,
                sheets_processed=[],
                total_rows=0,
                extracted_rows=0,
                failed_rows=0,
                items=[],
                errors=[]
            )

        items: List[ExtractedScheduleItem] = []
        errors: List[ScheduleExtractionError] = []
        total_rows = 0

        for sheet_name, df in sheets.items():
            total_rows += len(df)
            
# Detect format and parse accordingly
            format_type = cls._detect_schedule_format(df, str(sheet_name))
            
            if format_type == "flat":
                # Use existing flat parsing logic
                columns = cls._column_map(list(df.columns))
                if "date_of_training" not in columns or "topic" not in columns:
                    # Try to find header row
                    try:
                        if filename.lower().endswith(".csv"):
                            raw_sheet = pd.read_csv(io.BytesIO(file_contents), header=None)
                        else:
                            raw_sheet = pd.read_excel(io.BytesIO(file_contents), sheet_name=sheet_name, header=None)
                        header_row = cls._find_header_row(raw_sheet)
                        if header_row is not None:
                            df = raw_sheet.iloc[header_row + 1:].copy()
                            df.columns = raw_sheet.iloc[header_row].tolist()
                            df = df.reset_index(drop=True)
                            columns = cls._column_map(list(df.columns))
                    except Exception:
                        pass
                
                if "date_of_training" not in columns or "topic" not in columns:
                    errors.append(ScheduleExtractionError(
                        source_sheet=str(sheet_name),
                        source_row=1,
                        message="Missing schedule headers. Expected a training date column and topic/module column."
                    ))
                    continue
                
                for index, row in df.iterrows():
                    source_row = int(index) + 2
                    try:
                        if row.isna().all():
                            continue
                        training_date = cls._parse_datetime(row.get(columns["date_of_training"]))
                        topic = cls._clean_str(row.get(columns.get("topic"))) if columns.get("topic") else None
                        if not training_date:
                            raise ValueError("training date is missing or invalid")
                        if not topic:
                            raise ValueError("topic is missing")

                        batch_id = cls._clean_str(row.get(columns.get("batch_id"))) if columns.get("batch_id") else target_batch_id
                        items.append(ExtractedScheduleItem(
                            source_sheet=str(sheet_name),
                            source_row=source_row,
                            batch_id=batch_id,
                            date_of_training=training_date,
                            start_time=cls._parse_time(row.get(columns.get("start_time"))) if columns.get("start_time") else None,
                            end_time=cls._parse_time(row.get(columns.get("end_time"))) if columns.get("end_time") else None,
                            topic=topic,
                            faculty_name=cls._clean_str(row.get(columns.get("faculty_name"))) if columns.get("faculty_name") else None,
                            no_of_hours=cls._clean_decimal(row.get(columns.get("no_of_hours")), Decimal("8.0")) if columns.get("no_of_hours") else Decimal("8.0"),
                            venue=cls._clean_str(row.get(columns.get("venue"))) if columns.get("venue") else None,
                            location_city=cls._clean_str(row.get(columns.get("location_city"))) if columns.get("location_city") else None,
                            mode_of_delivery=cls._clean_str(row.get(columns.get("mode_of_delivery"))) or "Online" if columns.get("mode_of_delivery") else "Online",
                        ))
                    except (ValueError, TypeError) as exc:
                        errors.append(ScheduleExtractionError(
                            source_sheet=str(sheet_name),
                            source_row=source_row,
                            message=str(exc),
                        ))
            
            elif format_type == "toc":
                sheet_items, sheet_errors = cls._parse_toc_format(df, str(sheet_name), target_batch_id)
                items.extend(sheet_items)
                errors.extend(sheet_errors)
            
            elif format_type == "curriculum":
                sheet_items, sheet_errors = cls._parse_curriculum_format(df, str(sheet_name), target_batch_id)
                items.extend(sheet_items)
                errors.extend(sheet_errors)
            
            elif format_type == "topic_column":
                sheet_items, sheet_errors = cls._parse_topic_column_format(df, str(sheet_name), target_batch_id)
                items.extend(sheet_items)
                errors.extend(sheet_errors)
            
            else:
                errors.append(ScheduleExtractionError(
                    source_sheet=str(sheet_name),
                    source_row=1,
                    message=f"Unrecognized schedule format. Missing training date column and/or topic column. Columns found: {list(df.columns)}"
                ))

        return ScheduleIngestResponse(
            success=len(errors) == 0,
            message=f"Extracted {len(items)} schedule rows ({len(errors)} skipped).",
            filename=filename,
            source_filename=filename,
            sheets_processed=[str(name) for name in sheets],
            total_rows=total_rows,
            total_rows_parsed=total_rows,
            extracted_rows=len(items),
            failed_rows=len(errors),
            items=items,
            extracted_schedule=items,
            errors=errors,
        )

    @classmethod
    def apply_schedule_items(
        cls,
        schedule_repo: IScheduleRepository,
        user_repo: IUserRepository,
        target_batch_id: str,
        items: List[ExtractedScheduleItem],
        source_filename: Optional[str] = None,
        user_id: Optional[UUID] = None,
    ) -> ScheduleApplyResponse:
        """Validate and persist a complete schedule upload as one transaction."""
        batch = schedule_repo.get_batch_by_batch_id(target_batch_id)
        if not batch:
            try:
                batch = schedule_repo.get_batch_by_id(UUID(target_batch_id))
            except ValueError:
                batch = None
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target batch not found")
        if user_id:
            user = schedule_repo.get_active_user(user_id)
            if not user:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Active user not found")
            role = (user.role or "").lower()
            team = (user.team_detail.name if user.team_detail else "").strip().lower()
            if role != "admin" and team != "finance":
                scope_ids = set(user_repo.get_manager_scope_user_ids(user))
                batch_user_ids = {batch.primary_manager_id, batch.coordinator_id, batch.sales_spoc_id}
                if not scope_ids.intersection({value for value in batch_user_ids if value is not None}):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only apply schedules within your manager scope.")
        
        if batch.status == "Completed":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Schedule cannot be applied to a completed batch")
        if not items:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Schedule upload contains no valid rows")

        existing_sessions = schedule_repo.list_scheduled_sessions_for_batch(batch.id)
        existing_dates = {session.session_date for session in existing_sessions}

        errors: List[dict] = []
        prepared = []
        seen_keys = set()
        for item in items:
            row_key = (item.date_of_training.date(), item.start_time, item.end_time, item.topic.strip().lower())
            if row_key in seen_keys:
                errors.append({"source_row": item.source_row, "message": "Duplicate schedule row in upload"})
                continue
            seen_keys.add(row_key)

            if item.batch_id and item.batch_id not in {batch.batch_id, str(batch.id)}:
                errors.append({"source_row": item.source_row, "message": "Row belongs to a different batch"})
                continue
            
            # Check date bounds with helpful context
            item_date = item.date_of_training.date()
            if batch.start_date and item_date < batch.start_date.date():
                errors.append({
                    "source_row": item.source_row, 
                    "message": f"Training date {item_date} is before batch start date {batch.start_date.date()}. "
                               f"Consider extending batch start date or adjusting training date."
                })
                continue
            if batch.end_date and item_date > batch.end_date.date():
                errors.append({
                    "source_row": item.source_row, 
                    "message": f"Training date {item_date} is after batch end date {batch.end_date.date()}. "
                               f"Extend the batch end date and update training days and total hours, "
                               f"submit the batch changes for reapproval, then retry the schedule. "
                               f"Batch date range: {batch.start_date.date() if batch.start_date else 'Not set'} to {batch.end_date.date() if batch.end_date else 'Not set'}"
                })
                continue

            faculty_name = (item.faculty_name or batch.faculty_assigned_text or "").strip()
            if not faculty_name:
                errors.append({"source_row": item.source_row, "message": "Faculty name is required"})
                continue

            s_date = item.date_of_training.date() if isinstance(item.date_of_training, datetime) else item.date_of_training
            existing = schedule_repo.find_existing_session(batch.id, s_date, item.topic.strip())
            if existing:
                errors.append({"source_row": item.source_row, "message": "Matching session already exists for this batch"})
                continue

            prepared.append((item, faculty_name))

        generated = []
        if not errors and batch.training_days is not None:
            total_session_count = len(existing_sessions) + len(prepared)
            if total_session_count > batch.training_days:
                errors.append({
                    "source_row": 0,
                    "message": (
                        f"Schedule exceeds training_days ({batch.training_days}) with "
                        f"{total_session_count} scheduled sessions. Every training_sessions row "
                        "counts as one session, including multiple sessions on the same date. "
                        "Extend the batch end date and training days (and update total hours), "
                        "then submit the batch changes for reapproval before retrying the schedule."
                    ),
                })

        if not errors and batch.training_days is not None and batch.training_days > 0 and batch.start_date and batch.end_date:
            scheduled_dates = existing_dates.union(
                item.date_of_training.date() if isinstance(item.date_of_training, datetime) else item.date_of_training
                for item, _ in prepared
            )
            missing_count = max(
                0,
                batch.training_days - len(existing_sessions) - len(prepared),
            )
            if missing_count:
                faculty_name = (batch.faculty_assigned_text or getattr(batch, "faculty_name", None) or "").strip()
                if not faculty_name:
                    errors.append({"source_row": 0, "message": "A faculty assignment is required to generate missing sessions"})
                else:
                    candidate = batch.start_date.date()
                    end_candidate = batch.end_date.date() if batch.end_date else candidate + timedelta(days=30)
                    while candidate <= end_candidate and len(generated) < missing_count:
                        if candidate.weekday() < 5 and candidate not in scheduled_dates:
                            generated.append((
                                candidate,
                                faculty_name,
                            ))
                            scheduled_dates.add(candidate)
                        candidate += timedelta(days=1)
                    if len(generated) < missing_count:
                        errors.append({"source_row": 0, "message": "The batch date range does not contain enough missing weekdays to satisfy training_days"})

        if errors:
            schedule_repo.rollback()
            # Aggregate similar errors for better readability
            error_summary = cls._aggregate_errors(errors)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, 
                detail={
                    "message": "Schedule was not applied",
                    "errors": errors,
                    "summary": error_summary
                }
            )

        sessions = []
        for idx, (item, faculty_name) in enumerate(prepared, start=1):
            s_date = item.date_of_training.date() if isinstance(item.date_of_training, datetime) else item.date_of_training
            sessions.append(TrainingSession(
                batch_id=batch.id,
                sequence_number=idx,
                session_date=s_date,
                day_name=s_date.strftime("%A") if hasattr(s_date, "strftime") else None,
                start_time=item.start_time,
                end_time=item.end_time,
                duration_hours=item.no_of_hours,
                module=item.topic,
                trainer_name=faculty_name,
                status="Scheduled",
            ))
        for gen_idx, (generated_date, faculty_name) in enumerate(generated, start=len(prepared) + 1):
            sessions.append(TrainingSession(
                batch_id=batch.id,
                sequence_number=gen_idx,
                session_date=generated_date,
                day_name=generated_date.strftime("%A") if hasattr(generated_date, "strftime") else None,
                start_time=time(9, 0),
                end_time=time(17, 0),
                duration_hours=Decimal("8.0"),
                module="Generated training day - details required",
                trainer_name=faculty_name,
                status="Scheduled",
            ))

        try:
            sessions = schedule_repo.persist_sessions(sessions)
            # Update schedule_complete flag on batch
            total_scheduled = schedule_repo.get_scheduled_session_count(batch.id)
            batch.schedule_complete = (total_scheduled >= batch.training_days)
            schedule_repo.commit()
        except IntegrityError as e:
            schedule_repo.rollback()
            # Handle unique constraint violation on (batch_id, session_date, module)
            if "uq_batch_date_module" in str(e.orig):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"message": "Schedule was not applied", "errors": [
                        {"source_row": 0, "message": "Duplicate session detected: same batch, date, and module already exists"}
                    ]}
                )
            raise
        except Exception:
            schedule_repo.rollback()
            raise

        return ScheduleApplyResponse(
            success=True,
            target_batch_id=batch.batch_id,
            source_filename=source_filename,
            applied_rows=len(sessions),
            session_ids=[session.id for session in sessions],
        )

    @classmethod
    def _aggregate_errors(cls, errors: List[dict]) -> dict:
        """Group similar errors and provide summary."""
        from collections import Counter
        
        message_counts = Counter(e.get("message", "") for e in errors)
        
        # Categorize errors
        categories = {
            "date_out_of_range": 0,
            "missing_faculty": 0,
            "duplicate": 0,
            "batch_mismatch": 0,
            "existing_session": 0,
            "conflict": 0,
            "other": 0
        }
        
        for msg, count in message_counts.items():
            lower = msg.lower()
            if "before the batch start date" in lower or "after the batch end date" in lower:
                categories["date_out_of_range"] += count
            elif "faculty name is required" in lower:
                categories["missing_faculty"] += count
            elif "duplicate" in lower:
                categories["duplicate"] += count
            elif "different batch" in lower:
                categories["batch_mismatch"] += count
            elif "already exists" in lower:
                categories["existing_session"] += count
            elif "overlap" in lower or "double booking" in lower or "daily hours" in lower or "blocked" in lower:
                categories["conflict"] += count
            else:
                categories["other"] += count
        
        # Remove zero counts
        categories = {k: v for k, v in categories.items() if v > 0}
        
        return {
            "total_errors": len(errors),
            "by_type": categories,
            "most_common": message_counts.most_common(5)
        }
