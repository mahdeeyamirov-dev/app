import Foundation

struct BaseMetricStatus: Identifiable, Codable {
    let id: Int
    let key: String?
    let name: String
    let minValue: Double
    let value: Double
    let hasValue: Bool
    /// Period ('YYYY-MM-DD') the shown value was entered for; nil when there is no value.
    let periodStart: String?
    let periodEnd: String?
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

/// A value a participant entered for a period of days ('YYYY-MM-DD', inclusive).
struct MetricEntry: Codable, Hashable {
    let value: Double
    let periodStart: String
    let periodEnd: String

    var periodEndDate: Date { DashboardWindow.date(from: periodEnd) ?? .distantPast }
}

struct MetricWithHistory: Identifiable, Codable {
    let id: Int
    let key: String?
    let name: String
    let minValue: Double
    let value: Double
    let hasValue: Bool
    /// Period ('YYYY-MM-DD') the shown value was entered for; nil when there is no value.
    let periodStart: String?
    let periodEnd: String?
    let isGreen: Bool
    let entries: [MetricEntry]
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
