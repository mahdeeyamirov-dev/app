import Foundation

struct BaseMetricStatus: Identifiable, Codable {
    let id: Int
    let key: String?
    let name: String
    let minValue: Double
    let value: Double
    let isGreen: Bool
}

struct ParticipantSnapshot: Identifiable, Codable {
    let id: Int
    let telegramId: Int
    let displayName: String
    let percentGreen: Int
    let metrics: [BaseMetricStatus]
}

struct SnapshotResponse: Codable {
    let participants: [ParticipantSnapshot]
}

struct ParticipantHistory: Identifiable, Codable {
    let id: Int
    let telegramId: Int
    let displayName: String
    let weeklyPercents: [Int]
    let currentPercent: Int
}

struct HistoryResponse: Codable {
    let weeks: Int
    let participants: [ParticipantHistory]
}
