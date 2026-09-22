import Foundation

@MainActor
final class DashboardService: ObservableObject {
    @Published var participants: [ParticipantSnapshot] = []
    @Published var history: [ParticipantHistory] = []
    @Published var weekStarts: [String] = []
    @Published var groups: [DashboardGroup] = []

    private var generation = 0
    @Published var isLoading = false
    @Published var errorMessage: String?

    func refreshGroups(serverURL: String, apiToken: String) async {
        await load {
            let response: GroupsResponse = try await Self.fetchJSON(
                path: "api/groups",
                serverURL: serverURL,
                apiToken: apiToken
            )
            return response
        } apply: { response in
            self.groups = response.groups
        }
    }

    func refreshSnapshot(group: String, window: DashboardWindow, serverURL: String, apiToken: String) async {
        await load {
            let response: SnapshotResponse = try await Self.fetchJSON(
                path: "api/dashboard/base",
                queryItems: Self.queryItems(group: group, window: window),
                serverURL: serverURL,
                apiToken: apiToken
            )
            return response
        } apply: { response in
            self.participants = response.participants.sorted { $0.percentGreen > $1.percentGreen }
        }
    }

    func refreshHistory(group: String, window: DashboardWindow, serverURL: String, apiToken: String) async {
        await load {
            let response: HistoryResponse = try await Self.fetchJSON(
                path: "api/dashboard/base/history",
                queryItems: Self.queryItems(group: group, window: window),
                serverURL: serverURL,
                apiToken: apiToken
            )
            return response
        } apply: { response in
            self.weekStarts = response.weekStarts
            self.history = response.participants.sorted { $0.periodPercent > $1.periodPercent }
        }
    }

    /// Loads one participant with the full value history of every base metric.
    /// Errors are thrown to the caller so the detail sheet can show them itself
    /// without replacing the whole dashboard with an error screen.
    static func fetchParticipant(
        id: Int,
        group: String,
        window: DashboardWindow,
        serverURL: String,
        apiToken: String
    ) async throws -> ParticipantDetail {
        try await fetchJSON(
            path: "api/dashboard/base/participants/\(id)",
            queryItems: queryItems(group: group, window: window),
            serverURL: serverURL,
            apiToken: apiToken
        )
    }

    private static func queryItems(group: String, window: DashboardWindow) -> [URLQueryItem] {
        [
            URLQueryItem(name: "group", value: group),
            URLQueryItem(name: "from", value: window.from),
            URLQueryItem(name: "to", value: window.to),
        ]
    }

    static func message(for error: Error) -> String {
        (error as? DashboardError)?.message ?? error.localizedDescription
    }

    /// Runs a request and applies its result only if no newer request started
    /// meanwhile — otherwise quick taps on ‹ › could let an older window's
    /// response land last and show data for the wrong dates.
    private func load<T>(_ fetch: () async throws -> T, apply: (T) -> Void) async {
        generation += 1
        let current = generation
        isLoading = true
        errorMessage = nil
        do {
            let result = try await fetch()
            guard current == generation else { return }
            apply(result)
        } catch {
            guard current == generation else { return }
            errorMessage = Self.message(for: error)
        }
        isLoading = false
    }

    private static func fetchJSON<T: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        serverURL: String,
        apiToken: String
    ) async throws -> T {
        let trimmedURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = apiToken.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedURL.isEmpty, !trimmedToken.isEmpty else {
            throw DashboardError(message: "Укажите адрес сервера и API-токен в настройках")
        }
        guard let base = URL(string: trimmedURL) else {
            throw DashboardError(message: "Некорректный адрес сервера")
        }
        var components = URLComponents(
            url: base.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if !queryItems.isEmpty {
            components?.queryItems = queryItems
        }
        guard let url = components?.url else {
            throw DashboardError(message: "Некорректный адрес сервера")
        }

        var request = URLRequest(url: url)
        request.setValue(trimmedToken, forHTTPHeaderField: "x-api-token")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DashboardError(message: "Нет ответа от сервера")
        }
        guard httpResponse.statusCode == 200 else {
            let message = httpResponse.statusCode == 401
                ? "Неверный API-токен"
                : "Сервер вернул ошибку (\(httpResponse.statusCode))"
            throw DashboardError(message: message)
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(T.self, from: data)
    }
}

struct DashboardError: Error {
    let message: String
}
