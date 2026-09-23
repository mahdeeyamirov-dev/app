import Foundation

/// A base metric's total for the requested window against its target.
/// Targets are weekly; for a day or a month the server scales `minValue`
/// to the window's length (except for "best result" metrics).
struct BaseMetricStatus: Identifiable, Codable {
    let id: Int
    let key: String?
    let name: String
    let type: MetricType
    let aggregate: MetricAggregate
    let unit: String
    let weeklyTarget: Double
    let minValue: Double
    let value: Double
    let hasValue: Bool
    let isGreen: Bool
}

struct ParticipantSnapshot: Identifiable, Codable {
    let id: Int
    let telegramId: Int
    let displayName: String
    let percentGreen: Int
    let lastUpdatedAt: Date?
    let metrics: [BaseMetricStatus]
}

struct SnapshotResponse: Codable {
    let participants: [ParticipantSnapshot]
}

struct DashboardGroup: Identifiable, Codable, Hashable {
    let key: String
    let name: String

    var id: String { key }
}

struct GroupsResponse: Codable {
    let groups: [DashboardGroup]
}

/// A value a participant entered for a day or a week ('YYYY-MM-DD', inclusive).
struct MetricEntry: Codable, Hashable {
    let value: Double
    let periodStart: String
    let periodEnd: String
    let recordedAt: Date
}

/// A metric's total for one Monday-to-Sunday week.
struct WeekTotal: Codable, Hashable {
    let weekStart: String
    let value: Double
    let hasValue: Bool

    var weekStartDate: Date { DashboardWindow.date(from: weekStart) ?? .distantPast }
}

struct MetricWithHistory: Identifiable, Codable {
    let id: Int
    let key: String?
    let name: String
    let type: MetricType
    let aggregate: MetricAggregate
    let unit: String
    let weeklyTarget: Double
    let minValue: Double
    let value: Double
    let hasValue: Bool
    let isGreen: Bool
    /// Entries made within the requested window.
    let entries: [MetricEntry]
    /// Weekly totals for the last weeks up to the window's end, oldest first.
    let weeks: [WeekTotal]
}

struct ParticipantDetail: Identifiable, Codable {
    let id: Int
    let displayName: String
    let percentGreen: Int
    let lastUpdatedAt: Date?
    let metrics: [MetricWithHistory]
}

struct ParticipantHistory: Identifiable, Codable {
    let id: Int
    let telegramId: Int
    let displayName: String
    let weeklyPercents: [Int]
    /// % green over the whole requested window (e.g. the month).
    let periodPercent: Int
}

struct HistoryResponse: Codable {
    let weekStarts: [String]
    let participants: [ParticipantHistory]
}

/// "count": the participant sends a number. "check": one tap marks the day done.
enum MetricType: String, Codable, CaseIterable, Identifiable {
    case count
    case check

    var id: String { rawValue }

    var title: String {
        switch self {
        case .count: return "Число"
        case .check: return "Отметка"
        }
    }
}

/// How entries add up over a week: summed, or the best single result (scores).
enum MetricAggregate: String, Codable, CaseIterable, Identifiable {
    case sum
    case max

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sum: return "Сумма"
        case .max: return "Лучший"
        }
    }
}

/// Editable definition of a group metric, as stored in the server's config.json.
/// `key` is assigned by the server and ties the metric to its history, so it
/// is kept across renames; new metrics are sent without one.
struct MetricConfig: Codable, Identifiable, Hashable {
    var localID = UUID()
    var key: String?
    var name: String
    var type: MetricType
    var aggregate: MetricAggregate
    var target: Double
    var unit: String

    var id: UUID { localID }

    private enum CodingKeys: String, CodingKey {
        case key, name, type, aggregate, target, unit
    }

    init(name: String = "", type: MetricType = .count, aggregate: MetricAggregate = .sum, target: Double = 1, unit: String = "") {
        self.name = name
        self.type = type
        self.aggregate = aggregate
        self.target = target
        self.unit = unit
    }
}

struct GroupConfig: Codable, Identifiable, Hashable {
    var localID = UUID()
    var key: String?
    var name: String
    var metrics: [MetricConfig]

    var id: UUID { localID }

    private enum CodingKeys: String, CodingKey {
        case key, name, metrics
    }

    init(name: String, metrics: [MetricConfig] = []) {
        self.name = name
        self.metrics = metrics
    }
}

/// Everything editable on the server: groups, their metrics and the times the
/// bot sends the evening reminder and the Sunday summary ("HH:mm", nil = off).
struct TrackerConfig: Codable, Equatable {
    var reminderTime: String?
    var summaryTime: String?
    var groups: [GroupConfig]
}
